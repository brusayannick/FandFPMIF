"""
Process complexity metrics faithfully implementing the WWU_processcomplexity
reference (Rüschel 2025, WWU Münster; Complexity.py).

Key algorithmic notes
---------------------
Variant entropy  — Boltzmann-style entropy over the EPA c-index partition
                   (node counts per branch class), NOT Shannon over variant
                   frequencies.

Sequence entropy — Same Boltzmann formula but weighted by event counts;
                   forgetting variants re-weight events by recency.

Affinity         — Weighted Jaccard similarity between variant DF-pattern
                   sets, normalised by total case pairs.

Structure        — 1 − |union of all DF edges| / variety²  (pure Python,
                   no SPMF needed).

Lempel-Ziv       — LZ76 on the GLOBALLY time-sorted activity sequence
                   (events from all cases interleaved by timestamp).

References: Günther & van der Aalst (2007), Pentland (2003), LZ (1976).
"""

from __future__ import annotations

import math
from statistics import mean, median, stdev
from typing import Any

import pandas as pd


# ── Extended Prefix Automaton (EPA) ──────────────────────────────────────────

_State = dict[str, Any]


def build_epa(df: pd.DataFrame) -> tuple[dict[int, _State], dict[int, list[int]]]:
    """
    Build the Extended Prefix Automaton in global timestamp order.

    State dict shape: {id: {'c': int, 'j': int, 'children': dict[str,int],
                            'timestamps': list[pd.Timestamp]}}

    Returns (states, c_index) where c_index maps each c-value to a list of
    state IDs (root/c=0 excluded — mirrors original create_c_index logic).
    """
    df_sorted = df.sort_values("timestamp")

    states: dict[int, _State] = {
        0: {"c": 0, "j": 0, "children": {}, "timestamps": []}
    }
    last_state: dict[Any, int] = {}  # case_id → state_id
    c_counter = 1  # pa.c starts at 1 in the original Graph.__init__
    next_id = 1

    for row in df_sorted.itertuples(index=False):
        case_id = row.case_id
        activity = row.activity
        ts = row.timestamp

        pred_id = last_state.get(case_id, 0)
        pred = states[pred_id]

        if activity in pred["children"]:
            curr_id = pred["children"][activity]
        else:
            if len(pred["children"]) > 0:
                # Parent already has at least one child → branching → new c
                c_counter += 1
                curr_c = c_counter
            else:
                # First child of this node → extend current branch → inherit c
                curr_c = pred["c"] if pred_id != 0 else c_counter

            states[next_id] = {
                "c": curr_c,
                "j": pred["j"] + 1,
                "children": {},
                "timestamps": [],
            }
            pred["children"][activity] = next_id
            curr_id = next_id
            next_id += 1

        states[curr_id]["timestamps"].append(ts)
        last_state[case_id] = curr_id

    # Build c_index, skip root (sid=0, c=0)
    c_index: dict[int, list[int]] = {}
    for sid in range(1, next_id):
        c = states[sid]["c"]
        c_index.setdefault(c, []).append(sid)

    return states, c_index


# ── Boltzmann entropy helper ──────────────────────────────────────────────────

def _boltzmann(total: float, partition_sizes: list[float]) -> tuple[float, float]:
    """
    H = log(N)·N − Σ log(eᵢ)·eᵢ    (Boltzmann/Rényi-style entropy)

    Equals N · Shannon_H(eᵢ/N).  Returns (H, H / normalize) where normalize
    = log(N)·N (the H value for N = total, single partition).
    """
    if total <= 0:
        return 0.0, 0.0
    base = math.log(total) * total
    h = base
    for e in partition_sizes:
        if e > 0:
            h -= math.log(e) * e
    try:
        return h, h / base
    except ZeroDivisionError:
        return 0.0, 0.0


# ── Variant entropy (graph_complexity) ───────────────────────────────────────

def variant_entropy(states: dict[int, _State], c_index: dict[int, list[int]]) -> tuple[float, float]:
    """
    Variant entropy: Boltzmann entropy over the EPA c-index node-count
    partition.  Returns (H, H_normalised ∈ [0,1]).
    """
    n_nodes = len(states) - 1  # exclude root
    if n_nodes <= 0:
        return 0.0, 0.0
    partition_sizes = [float(len(ids)) for ids in c_index.values()]
    return _boltzmann(float(n_nodes), partition_sizes)


# ── Sequence entropy (log_complexity) ────────────────────────────────────────

def sequence_entropy(states: dict[int, _State], c_index: dict[int, list[int]]) -> tuple[float, float]:
    """Standard sequence entropy: Boltzmann over event-count partition."""
    total = float(sum(len(states[sid]["timestamps"]) for sid in range(1, len(states))))
    if total <= 0:
        return 0.0, 0.0
    partition_sizes = [
        float(sum(len(states[sid]["timestamps"]) for sid in ids))
        for ids in c_index.values()
    ]
    return _boltzmann(total, partition_sizes)


def sequence_entropy_forgetting(
    states: dict[int, _State],
    c_index: dict[int, list[int]],
    forgetting: str,
    k: float = 1.0,
) -> tuple[float, float]:
    """
    Sequence entropy with linear or exponential temporal forgetting.

    Recent events carry higher weight; older events are discounted.
    The normalisation base is always the UNWEIGHTED event count (matching
    the original's single `normalize` variable outside the if/elif branches).

    forgetting: 'linear' | 'exponential'
    k: forgetting coefficient for exponential mode (default 1.0)
    """
    all_ts = [
        (sid, ts)
        for sid in range(1, len(states))
        for ts in states[sid]["timestamps"]
    ]
    if not all_ts:
        return 0.0, 0.0

    raw_timestamps = [ts for _, ts in all_ts]
    last_ts = max(raw_timestamps)
    first_ts = min(raw_timestamps)
    try:
        timespan = (last_ts - first_ts).total_seconds()
    except Exception:
        timespan = 0.0

    def _weight(ts: Any) -> float:
        try:
            t = (last_ts - ts).total_seconds() / timespan
        except (ZeroDivisionError, TypeError):
            return 1.0
        if forgetting == "linear":
            return 1.0 - t
        else:
            return math.exp(-k * t)

    # Unweighted normalise (same for all forgetting variants)
    total_events = float(len(all_ts))
    if total_events < 1:
        return 0.0, 0.0
    normalize = total_events * math.log(total_events)

    # Weighted total
    total_w = sum(_weight(ts) for _, ts in all_ts)
    if total_w <= 0:
        return 0.0, 0.0

    h = math.log(total_w) * total_w
    for ids in c_index.values():
        e = sum(_weight(ts) for sid in ids for ts in states[sid]["timestamps"])
        if e > 0:
            h -= math.log(e) * e

    try:
        return h, h / normalize
    except ZeroDivisionError:
        return 0.0, 0.0


# ── Lempel-Ziv complexity ─────────────────────────────────────────────────────

def lempel_ziv_complexity(df: pd.DataFrame) -> int:
    """
    LZ76 complexity on the GLOBALLY time-sorted activity sequence.

    Events from all cases are merged and ordered by timestamp (mirroring
    the original which uses a single sorted `log` list).
    """
    activities = df.sort_values("timestamp")["activity"].tolist()
    if not activities:
        return 0

    # Map to integers for efficient hashing
    vocab = {a: i for i, a in enumerate(sorted(set(activities)))}
    seq = tuple(vocab[a] for a in activities)

    n = len(seq)
    seen: set[tuple[int, ...]] = set()
    complexity = 0
    i = 0
    while i < n:
        k = 1
        while i + k <= n and seq[i : i + k] in seen:
            k += 1
        seen.add(seq[i : i + k])
        complexity += 1
        i += k
    return complexity


# ── Affinity ──────────────────────────────────────────────────────────────────

def affinity(df: pd.DataFrame) -> float:
    """
    Weighted Jaccard similarity between variant directly-follows pattern sets.

    For each pair of distinct variants (v1, v2):
        contribution = (|DF(v1) ∩ DF(v2)| / |DF(v1) ∪ DF(v2)|) · count(v1) · count(v2)
    For identical variants (v == v):
        contribution = count(v) · (count(v) − 1)   [Jaccard = 1]
    Normalised by total_cases · (total_cases − 1).

    Returns NaN if fewer than 2 cases.
    """
    variant_counts: dict[tuple[str, ...], int] = {}
    df_sets: dict[tuple[str, ...], set[tuple[str, str]]] = {}

    for _, group in df.sort_values("timestamp").groupby("case_id", sort=False):
        acts = tuple(group["activity"].tolist())
        variant_counts[acts] = variant_counts.get(acts, 0) + 1
        if acts not in df_sets:
            df_sets[acts] = {(acts[i - 1], acts[i]) for i in range(1, len(acts))}

    variants = list(variant_counts.keys())
    total_cases = sum(variant_counts.values())

    if total_cases < 2:
        return float("nan")

    m_affinity = 0.0
    for i, v1 in enumerate(variants):
        for j, v2 in enumerate(variants):
            if i != j:
                overlap = len(df_sets[v1] & df_sets[v2])
                union = len(df_sets[v1] | df_sets[v2])
                if union > 0:
                    m_affinity += (overlap / union) * variant_counts[v1] * variant_counts[v2]
            else:
                c = variant_counts[v1]
                m_affinity += c * (c - 1)

    return m_affinity / (total_cases * (total_cases - 1))


# ── Structure ─────────────────────────────────────────────────────────────────

def structure(df: pd.DataFrame) -> float:
    """
    Structure score = 1 − |union of all directly-follows edges| / variety².

    High value → few distinct DF edges relative to the theoretical max →
    highly structured process.
    """
    activities = df["activity"].unique()
    v = len(activities)
    if v == 0:
        return float("nan")

    all_df: set[tuple[str, str]] = set()
    for _, group in df.sort_values("timestamp").groupby("case_id", sort=False):
        acts = group["activity"].tolist()
        for i in range(1, len(acts)):
            all_df.add((acts[i - 1], acts[i]))

    return 1.0 - len(all_df) / (v * v)


# ── Additional measures ───────────────────────────────────────────────────────

def magnitude(df: pd.DataFrame) -> int:
    """Total number of events in the log (= len(log) in original)."""
    return len(df)


def variety(df: pd.DataFrame) -> int:
    """Number of distinct activities (= variety in original)."""
    return int(df["activity"].nunique())


def support(df: pd.DataFrame) -> int:
    """Number of cases (traces)."""
    return int(df["case_id"].nunique())


def level_of_detail(df: pd.DataFrame) -> float:
    """Mean number of distinct activities per case."""
    per_case = df.groupby("case_id")["activity"].nunique()
    return float(per_case.mean()) if len(per_case) else 0.0


def pct_distinct_traces(df: pd.DataFrame) -> float:
    """Percentage of cases that follow a unique variant (0–100)."""
    n_cases = df["case_id"].nunique()
    if n_cases == 0:
        return 0.0
    n_variants = (
        df.sort_values("timestamp")
        .groupby("case_id")["activity"]
        .apply(tuple)
        .nunique()
    )
    return (n_variants / n_cases) * 100.0


def trace_length_stats(df: pd.DataFrame) -> dict[str, float]:
    """Min / avg / max trace length (events per case)."""
    lengths = df.groupby("case_id").size().tolist()
    if not lengths:
        return {"min": 0.0, "avg": 0.0, "max": 0.0, "std": 0.0, "median": 0.0}
    return {
        "min": float(min(lengths)),
        "avg": mean(lengths),
        "max": float(max(lengths)),
        "std": stdev(lengths) if len(lengths) > 1 else 0.0,
        "median": float(median(lengths)),
    }


def log_duration_seconds(df: pd.DataFrame) -> float:
    """Time span of the event log in seconds."""
    if df.empty:
        return 0.0
    ts = pd.to_datetime(df["timestamp"])
    return (ts.max() - ts.min()).total_seconds()


def time_granularity(df: pd.DataFrame) -> float:
    """
    Mean of per-case minimum inter-event time (seconds).

    Mirrors original measure_time_granularity which computes the smallest
    time difference between consecutive events for each case and averages.
    """
    per_case_min: list[float] = []
    for _, group in df.sort_values("timestamp").groupby("case_id", sort=False):
        ts = pd.to_datetime(group["timestamp"])
        diffs = ts.diff().dropna().dt.total_seconds()
        if not diffs.empty:
            per_case_min.append(float(diffs.min()))
    return mean(per_case_min) if per_case_min else 0.0


def pentland_task(states: dict[int, _State]) -> int:
    """
    Pentland's task complexity = sum of j-values of leaf EPA nodes.

    Mirrors measure_pentland_task which sums n.j for all nodes with no
    successors.
    """
    return sum(
        s["j"]
        for sid, s in states.items()
        if sid != 0 and len(s["children"]) == 0
    )


def pentland_process(df: pd.DataFrame) -> float:
    """
    Pentland's process complexity = 10^(0.08 · (1 + e − v)).

    v = variety (distinct activities), e = distinct DF edges.
    """
    v = df["activity"].nunique()
    all_df: set[tuple[str, str]] = set()
    for _, group in df.sort_values("timestamp").groupby("case_id", sort=False):
        acts = group["activity"].tolist()
        for i in range(1, len(acts)):
            all_df.add((acts[i - 1], acts[i]))
    e = len(all_df)
    return 10 ** (0.08 * (1 + e - v))


def deviation_from_random(df: pd.DataFrame) -> float | None:
    """
    Deviation from random = 1 − √(Σ((f_ij − mean) / total)²).

    Higher → more structured (further from random transitions).
    Returns None if no transitions.
    """
    activities = df["activity"].unique().tolist()
    v = len(activities)
    if v == 0:
        return None
    idx = {a: i for i, a in enumerate(activities)}
    net = [[0] * v for _ in range(v)]
    n_trans = 0

    for _, group in df.sort_values("timestamp").groupby("case_id", sort=False):
        acts = group["activity"].tolist()
        for i in range(1, len(acts)):
            net[idx[acts[i - 1]]][idx[acts[i]]] += 1
            n_trans += 1

    if n_trans == 0:
        return None

    a_mean = n_trans / (v * v)
    dev = math.sqrt(sum(((c - a_mean) / n_trans) ** 2 for row in net for c in row))
    return 1.0 - dev


# ── Full metrics bundle ───────────────────────────────────────────────────────

def compute_all_metrics(
    df: pd.DataFrame,
    forgetting_k: float = 1.0,
) -> dict[str, Any]:
    """
    Compute all complexity metrics for a DataFrame subset.

    Returns a flat dict of metric_name → value (JSON-serialisable).
    """
    if df.empty or df["case_id"].nunique() == 0:
        return {}

    states, c_index = build_epa(df)

    h_var, h_var_norm = variant_entropy(states, c_index)
    h_seq, h_seq_norm = sequence_entropy(states, c_index)
    h_seq_lin, h_seq_lin_norm = sequence_entropy_forgetting(states, c_index, "linear")
    h_seq_exp, h_seq_exp_norm = sequence_entropy_forgetting(
        states, c_index, "exponential", k=forgetting_k
    )

    lz = lempel_ziv_complexity(df)
    aff = affinity(df)
    struct = structure(df)
    pt_task = pentland_task(states)
    pt_proc = pentland_process(df)
    dev_rand = deviation_from_random(df)

    tl = trace_length_stats(df)

    return {
        # EPA entropy
        "variant_entropy": h_var,
        "normalized_variant_entropy": h_var_norm,
        "sequence_entropy": h_seq,
        "normalized_sequence_entropy": h_seq_norm,
        "sequence_entropy_linear": h_seq_lin,
        "sequence_entropy_linear_norm": h_seq_lin_norm,
        "sequence_entropy_exponential": h_seq_exp,
        "sequence_entropy_exponential_norm": h_seq_exp_norm,
        # Structural
        "lempel_ziv": lz,
        "affinity": aff,
        "structure": struct,
        "deviation_from_random": dev_rand,
        # Pentland
        "pentland_task": pt_task,
        "pentland_process": pt_proc,
        # Log characteristics
        "magnitude": magnitude(df),
        "variety": variety(df),
        "support": support(df),
        "level_of_detail": level_of_detail(df),
        "pct_distinct_traces": pct_distinct_traces(df),
        "time_granularity_s": time_granularity(df),
        "log_duration_s": log_duration_seconds(df),
        # Trace length
        "mean_trace_length": tl["avg"],
        "median_trace_length": tl["median"],
        "std_trace_length": tl["std"],
        "min_trace_length": tl["min"],
        "max_trace_length": tl["max"],
    }


# ── Temporal windowing ────────────────────────────────────────────────────────

def split_by_window(
    df: pd.DataFrame,
    window: str = "week",
) -> list[dict[str, Any]]:
    """
    Split the event log into time windows.

    window: 'day' | 'week' | 'month'
    Returns list of {'label', 'start', 'end', 'df'} dicts ordered by time.
    """
    period_alias = {"day": "D", "week": "W", "month": "M"}
    alias = period_alias.get(window, "W")

    df2 = df.copy()
    df2["_ts"] = pd.to_datetime(df2["timestamp"])
    df2["_period"] = df2["_ts"].dt.to_period(alias)

    windows: list[dict[str, Any]] = []
    for period, group in df2.groupby("_period"):
        windows.append(
            {
                "label": str(period),
                "start": group["_ts"].min().isoformat(),
                "end": group["_ts"].max().isoformat(),
                "df": group.drop(columns=["_ts", "_period"]),
            }
        )
    return windows


# ── Pearson correlation matrix ────────────────────────────────────────────────

def pearson_correlation_matrix(
    windows_metrics: list[dict[str, Any]],
) -> tuple[list[str], list[list[float]]]:  # noqa: UP006
    """
    Pearson correlation between metrics across temporal windows.

    Returns (metric_names, matrix).
    Excludes count-only metrics (magnitude, support, variety, pentland_task)
    and metrics with zero variance.
    """
    import numpy as np

    if not windows_metrics:
        return [], []

    exclude = {"magnitude", "support", "variety", "pentland_task"}
    metric_keys = [
        k
        for k in windows_metrics[0].keys()
        if k not in exclude
    ]

    data = np.array(
        [
            [
                float(w.get(k, float("nan")) or float("nan"))
                for k in metric_keys
            ]
            for w in windows_metrics
        ],
        dtype=float,
    )

    # Drop constant or all-NaN columns
    valid = (np.nanstd(data, axis=0) > 1e-10) & (~np.all(np.isnan(data), axis=0))
    valid_keys = [k for k, v in zip(metric_keys, valid) if v]
    data = data[:, valid]

    if data.shape[1] < 2 or data.shape[0] < 2:
        return valid_keys, [[1.0] * len(valid_keys)] * len(valid_keys)

    corr = np.corrcoef(data.T)
    corr = np.nan_to_num(corr, nan=0.0)
    return valid_keys, corr.tolist()
