"""
SPMF subprocess wrapper for the process_complexity module.

Wraps spmf.jar (Sequential Pattern Mining Framework by Philippe Fournier-Viger,
GNU GPL v3) to compute the structure score via closed sequential pattern mining
(VMSP algorithm).

The JAR must be present at: modules/process_complexity/spmf.jar
Download from: https://www.philippe-fournier-viger.com/spmf/
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_JAR_PATH = Path(__file__).parent / "spmf.jar"


def _jar_path() -> Path:
    return _JAR_PATH


def _java_available() -> bool:
    try:
        subprocess.run(
            ["java", "-version"],
            capture_output=True,
            timeout=5,
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _traces_to_spmf_format(traces: list[list[str]]) -> tuple[str, dict[str, int]]:
    """
    Convert activity traces to SPMF sequential database format.

    SPMF uses integer item IDs. Each sequence is a space-separated list of
    items terminated by -1 per itemset and -2 at end of sequence.

    Returns (spmf_text, activity_to_id_mapping).
    """
    all_activities = sorted({a for trace in traces for a in trace})
    act_to_id = {a: i + 1 for i, a in enumerate(all_activities)}

    lines = []
    for trace in traces:
        parts = []
        for activity in trace:
            parts.append(str(act_to_id[activity]))
            parts.append("-1")
        parts.append("-2")
        lines.append(" ".join(parts))

    return "\n".join(lines), act_to_id


def compute_structure_score(
    traces: list[list[str]],
    min_support: float = 0.1,
) -> Optional[float]:
    """
    Compute the structure score using VMSP (frequent closed sequential patterns).

    The structure score is defined as:
        num_frequent_patterns / max_possible_patterns

    where max_possible_patterns = num_activities * (num_activities + 1) / 2
    (upper bound on distinct ordered pairs + singletons).

    Returns None if Java is unavailable or the JAR is missing, with a logged
    warning. The module continues with structure_score=null in the response.

    min_support: minimum support threshold in [0, 1] (default 0.1 = 10%)
    """
    jar = _jar_path()
    if not jar.exists():
        logger.warning(
            "spmf.jar not found at %s — structure_score will be null. "
            "Download from https://www.philippe-fournier-viger.com/spmf/",
            jar,
        )
        return None

    if not _java_available():
        logger.warning("java not found on PATH — structure_score will be null.")
        return None

    if not traces:
        return 0.0

    spmf_input, act_to_id = _traces_to_spmf_format(traces)
    n_traces = len(traces)
    abs_min_support = max(1, int(min_support * n_traces))

    with (
        tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8"
        ) as f_in,
        tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8"
        ) as f_out,
    ):
        f_in.write(spmf_input)
        input_path = f_in.name
        output_path = f_out.name

    try:
        result = subprocess.run(
            [
                "java",
                "-jar",
                str(jar),
                "run",
                "VMSP",
                input_path,
                output_path,
                str(abs_min_support),
            ],
            capture_output=True,
            timeout=120,
            text=True,
        )
        if result.returncode != 0:
            logger.warning("SPMF exited with code %d: %s", result.returncode, result.stderr[:500])
            return None

        pattern_count = _count_patterns(output_path)
        n_activities = len(act_to_id)
        max_patterns = max(1, n_activities * (n_activities + 1) // 2)
        return min(1.0, pattern_count / max_patterns)

    except subprocess.TimeoutExpired:
        logger.warning("SPMF timed out after 120 s — structure_score will be null.")
        return None
    except Exception as exc:
        logger.warning("SPMF error: %s — structure_score will be null.", exc)
        return None
    finally:
        for p in (input_path, output_path):
            try:
                os.unlink(p)
            except OSError:
                pass


def _count_patterns(output_path: str) -> int:
    """Count non-empty lines in SPMF output file (each line = one pattern)."""
    try:
        with open(output_path, encoding="utf-8") as f:
            return sum(1 for line in f if line.strip())
    except OSError:
        return 0
