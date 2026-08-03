#!/usr/bin/env python3
"""Render the Markdown sources in `source/` into the submission template.

Splices generated WordprocessingML into `word/document.xml`, preserving the
cover page, the table-of-contents field, the declaration of authorship and the
consent form. Uses the template's own style ids so the result is
indistinguishable from hand-authored content.

    python3 build_docx.py            # build
    python3 build_docx.py --check    # build, then assert no template scope
                                     # paragraph survived
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import zipfile
from pathlib import Path

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = f'xmlns:w="{W}"'

HERE = Path(__file__).resolve().parent
SRC = HERE / "source"
TEMPLATE = HERE / "PS_Flows___Funds_Documentation_-_PM-MATE.docx"
BACKUP = HERE / "PS_Flows___Funds_Documentation_-_PM-MATE_template.docx"

# Body text width in twips for the 1701-twip-margin section (11906 - 2*1701).
TABLE_WIDTH = 8500

BODY_FILES = [
    "01-introduction.md",
    "02-foundations.md",
    "03-platforms.md",
    "04-architecture.md",
    "05-modularity.md",
    "06-integration.md",
    "07-setup.md",
    "08-module-walkthrough.md",
    "09-project.md",
    "10-evaluation.md",
    "11-discussion.md",
    "12-conclusion.md",
]

APPENDIX_FILES = [
    "A-end-user-manual.md",
    "B-manifest-sdk-reference.md",
    "C-config-operations.md",
    "D-extended-modules.md",
    "E-defect-log.md",
    "F-glossary.md",
]

# Phrases from the template's scope paragraphs; --check asserts none survive.
SCOPE_MARKERS = [
    "Establish the setting:",
    "State precisely which problem",
    "Translate the problem statement into",
    "Declare what was explicitly excluded",
    "Introduce the minimum vocabulary",
    "Summarise discovery, conformance checking",
    "Introduce the comparison criteria",
    "Present the system in one diagram",
    "Justify the principal choices",
    "Treat isolation as an architectural property",
    "Describe the three backend concerns",
    "Open the core chapter by restating",
    "Define what a module is:",
    "Describe the startup sequence:",
    "Explain why this particular set of modules",
    "Narrate one integration end to end",
    "State what a reader must have before",
    "Give the shortest reproducible path",
    "Chapter rationale: Chapter 5 states the contract",
    "Describe how the team was organised",
    "State how the system is assessed",
    "Discuss the boundaries that follow",
    "Restate the problem, the approach",
    "Reading note for the authors",
    "Division of labour with the body",
    "Complete end-user documentation, written to be readable",
    "The lookup counterpart to Chapter 8: the manifest schema",
    "Indicative distribution for a report body",
]


# --------------------------------------------------------------------------
# XML helpers
# --------------------------------------------------------------------------

def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


INLINE_RE = re.compile(r"(\*\*.+?\*\*|(?<!\*)\*[^*]+?\*(?!\*)|`[^`]+?`)", re.S)


def runs(text: str, *, bold: bool = False, italic: bool = False) -> str:
    """Inline Markdown (**bold**, *italic*, `code`) to WordprocessingML runs."""
    out: list[str] = []
    for part in INLINE_RE.split(text):
        if not part:
            continue
        b, i, mono = bold, italic, False
        body = part
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            b, body = True, part[2:-2]
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            i, body = True, part[1:-1]
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            mono, body = True, part[1:-1]
        props = []
        if mono:
            props.append('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>')
        if b:
            props.append("<w:b/>")
        if i:
            props.append("<w:i/>")
        if mono:
            props.append('<w:sz w:val="20"/>')
        rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
        out.append(f'<w:r>{rpr}<w:t xml:space="preserve">{esc(body)}</w:t></w:r>')
    return "".join(out)


def para(style: str, text: str = "", *, num_id: int | None = None, extra_ppr: str = "") -> str:
    ppr = f'<w:pStyle w:val="{style}"/>'
    if num_id is not None:
        ppr += f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr>'
    ppr += extra_ppr
    return f"<w:p><w:pPr>{ppr}</w:pPr>{runs(text)}</w:p>"


def raw_para(style: str, inner: str) -> str:
    return f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr>{inner}</w:p>'


def caption(label: str, text: str) -> str:
    """A caption whose number is a SEQ field, so the Figures/Tables lists fill."""
    return raw_para(
        "Caption",
        f'<w:r><w:t xml:space="preserve">{esc(label)} </w:t></w:r>'
        f'<w:fldSimple w:instr=" SEQ {esc(label)} \\* ARABIC ">'
        f"<w:r><w:t>1</w:t></w:r></w:fldSimple>"
        f'<w:r><w:t xml:space="preserve">: </w:t></w:r>{runs(text)}',
    )


def cell(width: int, content: str, *, shade: str | None = None) -> str:
    shd = f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>' if shade else ""
    return (
        f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shd}</w:tcPr>'
        f"{content}</w:tc>"
    )


def table(rows: list[list[str]]) -> str:
    """A grid table with a shaded, repeating header row."""
    ncols = max(len(r) for r in rows)
    rows = [r + [""] * (ncols - len(r)) for r in rows]
    weights = [
        max(4, max(len(r[c]) for r in rows) ** 0.6) for c in range(ncols)
    ]
    total = sum(weights)
    widths = [max(700, int(TABLE_WIDTH * w / total)) for w in weights]
    widths[-1] += TABLE_WIDTH - sum(widths)

    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    out = [
        "<w:tbl><w:tblPr>"
        '<w:tblStyle w:val="TableGrid"/>'
        f'<w:tblW w:w="{TABLE_WIDTH}" w:type="dxa"/>'
        '<w:tblLayout w:type="fixed"/>'
        '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1"'
        ' w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
        f"</w:tblPr><w:tblGrid>{grid}</w:tblGrid>"
    ]
    for idx, row in enumerate(rows):
        header = idx == 0
        trpr = "<w:trPr><w:tblHeader/></w:trPr>" if header else ""
        cells = []
        for c, text in enumerate(row):
            inner = raw_para(
                "BasicTextTable",
                runs(text, bold=header) if text else "",
            )
            cells.append(cell(widths[c], inner, shade="F2F2F2" if header else None))
        out.append(f"<w:tr>{trpr}{''.join(cells)}</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def figure_frame(instruction: str) -> str:
    """A shaded single-cell frame standing in for the artwork."""
    inner = raw_para(
        "BasicTextTable",
        '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">'
        "[ARTWORK TO BE INSERTED] </w:t></w:r>" + runs(instruction),
    )
    return (
        "<w:tbl><w:tblPr>"
        '<w:tblStyle w:val="TableGrid"/>'
        f'<w:tblW w:w="{TABLE_WIDTH}" w:type="dxa"/>'
        '<w:tblLayout w:type="fixed"/>'
        '<w:tblLook w:val="04A0"/></w:tblPr>'
        f'<w:tblGrid><w:gridCol w:w="{TABLE_WIDTH}"/></w:tblGrid>'
        f'<w:tr>{cell(TABLE_WIDTH, inner, shade="F7F7F7")}</w:tr></w:tbl>'
    )


# --------------------------------------------------------------------------
# Markdown -> WordprocessingML
# --------------------------------------------------------------------------

class Converter:
    def __init__(self, heading_styles: dict[int, str]) -> None:
        self.heading_styles = heading_styles
        self.num_id = 100          # fresh numbering instance per ordered list
        self.extra_nums: list[int] = []

    def next_num_id(self) -> int:
        self.num_id += 1
        self.extra_nums.append(self.num_id)
        return self.num_id

    def convert(self, text: str) -> str:
        lines = text.replace("\r\n", "\n").split("\n")
        out: list[str] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                i += 1
                continue

            # fenced code block
            if stripped.startswith("```"):
                i += 1
                block: list[str] = []
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    block.append(lines[i])
                    i += 1
                i += 1
                for code_line in block:
                    out.append(
                        raw_para(
                            "BasicTextSQL",
                            '<w:r><w:t xml:space="preserve">'
                            f"{esc(code_line)}</w:t></w:r>",
                        )
                    )
                continue

            # figure placeholder
            if stripped == "[[FIGURE]]":
                i += 1
                cap = ins = ""
                while i < len(lines) and lines[i].strip() != "[[/FIGURE]]":
                    entry = lines[i].strip()
                    if entry.startswith("caption:"):
                        cap = entry[len("caption:"):].strip()
                    elif entry.startswith("insert:"):
                        ins = entry[len("insert:"):].strip()
                    elif entry:
                        ins += " " + entry
                    i += 1
                i += 1
                out.append(figure_frame(ins))
                out.append(caption("Fig.", cap))
                continue

            # captioned table
            if stripped == "[[TABLE]]":
                i += 1
                cap = ""
                rows: list[list[str]] = []
                while i < len(lines) and lines[i].strip() != "[[/TABLE]]":
                    entry = lines[i].strip()
                    if entry.startswith("caption:"):
                        cap = entry[len("caption:"):].strip()
                    elif entry.startswith("|"):
                        cells = [c.strip() for c in entry.strip("|").split("|")]
                        if not all(set(c) <= set("-: ") for c in cells):
                            rows.append(cells)
                    i += 1
                i += 1
                if cap:
                    out.append(caption("Tab.", cap))
                if rows:
                    out.append(table(rows))
                out.append(para("BasicText", ""))
                continue

            # bare table (no caption)
            if stripped.startswith("|"):
                rows = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                    if not all(set(c) <= set("-: ") for c in cells):
                        rows.append(cells)
                    i += 1
                out.append(table(rows))
                out.append(para("BasicText", ""))
                continue

            # headings
            if stripped.startswith("#"):
                level = len(stripped) - len(stripped.lstrip("#"))
                style = self.heading_styles.get(level)
                if style:
                    out.append(para(style, stripped[level:].strip()))
                i += 1
                continue

            # blockquote: a normative statement
            if stripped.startswith(">"):
                block = []
                while i < len(lines) and lines[i].strip().startswith(">"):
                    block.append(lines[i].strip().lstrip(">").strip())
                    i += 1
                out.append(para("BasicTextIndentation", " ".join(block)))
                continue

            # unordered list
            if stripped.startswith("- "):
                while i < len(lines) and lines[i].strip().startswith("- "):
                    out.append(para("BasicTextList", lines[i].strip()[2:]))
                    i += 1
                continue

            # ordered list, on its own numbering instance
            if re.match(r"^\d+\.\s", stripped):
                nid = self.next_num_id()
                while i < len(lines) and re.match(r"^\d+\.\s", lines[i].strip()):
                    body = re.sub(r"^\d+\.\s+", "", lines[i].strip())
                    out.append(para("BasicTextNumberedList", body, num_id=nid))
                    i += 1
                continue

            # paragraph (may wrap across source lines)
            block = [stripped]
            i += 1
            while i < len(lines):
                nxt = lines[i].strip()
                if (
                    not nxt
                    or nxt.startswith(("#", "|", "- ", ">", "```", "[["))
                    or re.match(r"^\d+\.\s", nxt)
                ):
                    break
                block.append(nxt)
                i += 1
            out.append(para("BasicText", " ".join(block)))

        return "".join(out)


def tabbed_list(text: str) -> str:
    """Tab-separated `term<TAB>definition` lines (abbreviations, symbols)."""
    out = []
    for line in text.strip().split("\n"):
        if not line.strip():
            continue
        term, _, rest = line.partition("\t")
        out.append(
            raw_para(
                "BasicTextIndentation",
                f'<w:r><w:t xml:space="preserve">{esc(term)}</w:t></w:r>'
                f"<w:r><w:tab/></w:r>{runs(rest)}",
            )
        )
    return "".join(out)


# --------------------------------------------------------------------------
# document.xml surgery
# --------------------------------------------------------------------------

BLOCK_RE = re.compile(r"<w:(p|tbl)\b.*?</w:\1>|<w:p\b[^>]*/>", re.S)


def split_blocks(body: str) -> list[str]:
    blocks, pos = [], 0
    for m in BLOCK_RE.finditer(body):
        if m.start() > pos:
            blocks.append(body[pos:m.start()])
        blocks.append(m.group(0))
        pos = m.end()
    blocks.append(body[pos:])
    return blocks


TEXT_RE = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.S)
STYLE_RE = re.compile(r'<w:pStyle w:val="([^"]+)"')


def block_text(block: str) -> str:
    return "".join(TEXT_RE.findall(block))


def block_style(block: str) -> str:
    m = STYLE_RE.search(block)
    return m.group(1) if m else ""


def find_heading(blocks: list[str], style: str, text: str, start: int = 0) -> int:
    for idx in range(start, len(blocks)):
        if block_style(blocks[idx]) == style and block_text(blocks[idx]).strip() == text:
            return idx
    raise SystemExit(f"anchor not found: [{style}] {text!r}")


def merge_bibliography(blocks: list[str], additions: list[str]) -> None:
    """Insert new entries into the existing Bibliography run, alphabetically."""
    idxs = [i for i, b in enumerate(blocks) if block_style(b) == "Bibliography"]
    if not idxs:
        raise SystemExit("no Bibliography paragraphs found")
    first, last = idxs[0], idxs[-1]
    existing = [(block_text(blocks[i]).strip(), blocks[i]) for i in idxs]
    for entry in additions:
        existing.append((entry.strip(), para("Bibliography", entry.strip())))

    def key(item: tuple[str, str]) -> str:
        return re.sub(r"[^a-z ]", "", item[0].lower()).strip()

    merged = [b for _, b in sorted((e for e in existing if e[0]), key=key)]
    blocks[first:last + 1] = merged


def add_numbering(numbering_xml: str, num_ids: list[int], abstract_id: str) -> str:
    additions = "".join(
        f'<w:num w:numId="{n}"><w:abstractNumId w:val="{abstract_id}"/></w:num>'
        for n in num_ids
    )
    return numbering_xml.replace("</w:numbering>", additions + "</w:numbering>")


def set_update_fields(settings_xml: str) -> str:
    if "w:updateFields" in settings_xml:
        return re.sub(
            r'<w:updateFields[^/]*/>', '<w:updateFields w:val="true"/>', settings_xml
        )
    return settings_xml.replace(
        "<w:settings ", "<w:settings ", 1
    ).replace(
        "</w:settings>", '<w:updateFields w:val="true"/></w:settings>'
    )


def abstract_num_for(numbering_xml: str, num_id: str) -> str:
    m = re.search(
        rf'<w:num w:numId="{num_id}"[^>]*>\s*<w:abstractNumId w:val="(\d+)"',
        numbering_xml,
    )
    return m.group(1) if m else "16"


# --------------------------------------------------------------------------

def build(check: bool = False) -> None:
    if not TEMPLATE.exists():
        raise SystemExit(f"template missing: {TEMPLATE}")
    if not BACKUP.exists():
        shutil.copy2(TEMPLATE, BACKUP)
        print(f"backed up template -> {BACKUP.name}")

    with zipfile.ZipFile(BACKUP) as z:
        parts = {n: z.read(n) for n in z.namelist()}

    document = parts["word/document.xml"].decode("utf-8")
    head, body_xml, tail = re.match(
        r"(.*<w:body>)(.*)(</w:body>.*)", document, re.S
    ).groups()
    blocks = split_blocks(body_xml)

    body_conv = Converter({1: "Heading1", 2: "Heading2", 3: "Heading3"})
    appx_conv = Converter({1: "Heading8", 2: "Heading9", 3: "Heading9"})

    body_xml_new = "".join(
        body_conv.convert((SRC / f).read_text(encoding="utf-8")) for f in BODY_FILES
    )
    appx_xml_new = "".join(
        appx_conv.convert((SRC / f).read_text(encoding="utf-8")) for f in APPENDIX_FILES
    )

    # Resolve every anchor against the pristine template, then rewrite the
    # ranges back to front so earlier indices stay valid.
    abbrev_h = find_heading(blocks, "Heading1", "Abbreviations")
    symbols_h = find_heading(blocks, "Heading1", "Symbols")
    intro_h = find_heading(blocks, "Heading1", "Introduction")
    refs_h = find_heading(blocks, "Heading1", "References")
    appendix_h = find_heading(blocks, "Heading1", "Appendix")
    decl_i = next(
        i for i, b in enumerate(blocks)
        if block_text(b).strip().startswith("Declaration of Authorship")
    )

    # Appendix: replace the scope note, the six scope paragraphs, and the two
    # authoring-scaffolding sections (supervisor coverage, length budget).
    blocks[appendix_h + 1:decl_i] = [appx_xml_new]

    # References: merge the newly cited works into the existing entries.
    merge_bibliography(blocks, [
        line.strip()
        for line in (SRC / "92-references-additions.md").read_text(
            encoding="utf-8"
        ).strip().split("\n")
        if line.strip()
    ])

    # Body: chapters 1 to 12, replacing the reading note, the TODO block and
    # every heading-plus-scope-paragraph pair.
    blocks[intro_h:refs_h] = [body_xml_new]

    blocks[symbols_h + 1:intro_h] = [
        tabbed_list((SRC / "91-symbols.md").read_text(encoding="utf-8"))
        + para("BasicText", "")
    ]
    blocks[abbrev_h + 1:symbols_h] = [
        tabbed_list((SRC / "90-abbreviations.md").read_text(encoding="utf-8"))
        + para("BasicText", "")
    ]

    new_body = "".join(blocks)
    parts["word/document.xml"] = (head + new_body + tail).encode("utf-8")

    numbering = parts["word/numbering.xml"].decode("utf-8")
    abstract = abstract_num_for(numbering, "21")
    parts["word/numbering.xml"] = add_numbering(
        numbering, body_conv.extra_nums + appx_conv.extra_nums, abstract
    ).encode("utf-8")

    parts["word/settings.xml"] = set_update_fields(
        parts["word/settings.xml"].decode("utf-8")
    ).encode("utf-8")

    with zipfile.ZipFile(TEMPLATE, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    print(f"wrote {TEMPLATE.name}")

    if check:
        text = parts["word/document.xml"].decode("utf-8")
        plain = "".join(TEXT_RE.findall(text))
        failures = [m for m in SCOPE_MARKERS if m in plain]
        if failures:
            print("FAIL: template scope text survived:", file=sys.stderr)
            for f in failures:
                print(f"  - {f}", file=sys.stderr)
            sys.exit(1)
        print(f"check: no scope paragraphs survive ({len(SCOPE_MARKERS)} markers)")
        heads = [
            block_text(b).strip()
            for b in split_blocks(new_body)
            if block_style(b) in {"Heading1", "Heading2"}
        ]
        print(f"check: {len(heads)} chapter and section headings emitted")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    build(**vars(ap.parse_args()))
