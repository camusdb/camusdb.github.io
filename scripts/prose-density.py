#!/usr/bin/env python3
"""Score docs pages against the Natural Phrasing limits in AGENTS.md (section 12).

The score is the count of overused patterns per 1,000 words of prose. Code
blocks, inline code, front matter, and MDX imports are not counted. Table
cells and list items are counted as prose.

The script also counts list lead-ins (AGENTS.md, section 11): a line that ends
with a colon directly before a list, a table, or a code block. A lead-in is not
part of the rate. A page with a lead-in does not pass.

Usage:
    python3 scripts/prose-density.py                     # rank all pages in docs/
    python3 scripts/prose-density.py docs/a.md docs/b.md # score these pages
    python3 scripts/prose-density.py --hits docs/a.md    # list each sentence that counts

The exit status is 1 when a scored page is over the limits or has a list
lead-in, and 0 otherwise. This is a check for writers. It is not part of CI.
"""
import argparse
import os
import re
import sys

# The groups and limits of the table in AGENTS.md, section 12. Keep them the same.
GROUPS = {
    "join": (1.5, [", so", ", because", "first , then"]),
    "emph": (2.0, ["every", "whole", "its own", "never", "still", "nothing", "only when", "inside", "plain"]),
    "actor": (1.5, ["keeps", "holds", "stays", "rejects", "refuses", "falls back to", "fails with", "runs",
                    "accepts", "reports"]),
    "contr": (2.0, ["without", "has no", "with no", ", not", "instead of", "rather than"]),
}
LIST_LIMIT = 2.0
TOTAL_LIMIT = sum(limit for limit, _ in GROUPS.values()) + LIST_LIMIT  # 9.0
EXCESS_ALLOWED = 3   # uses above the group limits that a page can have and still pass
MIN_WORDS = 300      # shorter pages are not ranked: one use changes the rate too much

# A list lead-in (AGENTS.md, section 11): a line that ends with a colon directly before a list, a table, or a
# code block. The colon can be the last character of bold or italic text.
LEAD_END = re.compile(r":[*_]*$")
BLOCK_START = re.compile(r"^(?:[-*+]\s|\d+[.)]\s|\|)")  # a list item or a table row

GROUP_RX = {
    name: re.compile(r"(?:(?<= )|^)(%s)(?= |$)" % "|".join(re.escape(p) for p in patterns))
    for name, (_, patterns) in GROUPS.items()
}
# A sentence that lists three or more items in running text: "a, b, and c" or "a, b or c".
LIST3 = re.compile(
    r"(?:^| )[^ ,;:()—–]+(?: [^ ,;:()—–]+){0,3} , [^ ,;:()—–]+(?: [^ ,;:()—–]+){0,3} ,? (?:and|or) [^ ,;:()—–]+")
PRODUCT = re.compile(r"\bCamusDB\b")


def raw_lines(path):
    """Return (line_number, line, kind) for each line after the front matter.

    The kind is "fence" for the line that opens a code block, "skip" for the other lines of a code block and
    for the lines of an HTML comment, and "text" for the rest.
    """
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read().split("\n")
    start = 0
    if raw and raw[0].strip() == "---":
        end = 1
        while end < len(raw) and raw[end].strip() != "---":
            end += 1
        start = end + 1
    out = []
    in_fence = False
    fence = None
    in_comment = False
    for number, line in enumerate(raw[start:], start + 1):
        s = line.strip()
        m = None if in_fence or in_comment else re.match(r"^(```+|~~~+)", s)
        if in_fence:
            if s.startswith(fence):
                in_fence = False
            out.append((number, line, "skip"))
        elif m:
            in_fence = True
            fence = m.group(1)[:3]
            out.append((number, line, "fence"))
        elif in_comment:
            if "-->" in s:
                in_comment = False
            out.append((number, line, "skip"))
        elif s.startswith("<!--") and "-->" not in s:
            in_comment = True
            out.append((number, line, "skip"))
        else:
            out.append((number, line, "text"))
    return out


def lead_ins(path):
    """Return (line_number, text) for each list lead-in on the page."""
    lines = raw_lines(path)
    found = []
    for i, (number, line, kind) in enumerate(lines):
        s = re.sub(r"<!--.*?-->", " ", line).strip()
        if kind != "text" or not LEAD_END.search(s) or s.startswith(("#", "|")):
            continue
        following = next(((text.strip(), k) for _, text, k in lines[i + 1:] if text.strip()), None)
        if following and (following[1] == "fence" or (following[1] == "text" and BLOCK_START.match(following[0]))):
            found.append((number, s))
    return found


def md_lines(path):
    """Return (line_number, text) pairs of prose. Empty text marks a block boundary."""
    out = []
    for number, line, kind in raw_lines(path):
        s = line.strip()
        if kind != "text":
            out.append((number, ""))
            continue
        line = re.sub(r"<!--.*?-->", " ", line)
        if re.match(r"^\s*(import|export)\s", line) or s.startswith(":::"):
            out.append((number,""))
            continue
        if re.match(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$", line):
            out.append((number,""))
            continue
        is_table = s.startswith("|")
        is_block_start = bool(re.match(r"^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?)", line))
        if is_block_start:
            out.append((number,""))
            line = re.sub(r"^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?)", "", line)
        line = re.sub(r"!\[[^\]]*\]\((?:[^()]|\([^)]*\))*\)", " ", line)
        line = re.sub(r"\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)", r"\1", line)
        line = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", line)
        line = re.sub(r"`[^`]+`", " qqcodeqq ", line)
        line = re.sub(r"<code>.*?</code>", " qqcodeqq ", line)
        line = re.sub(r"</?(a|strong|em|b|i|span|sup|sub)\b[^>]*>", "", line)
        line = re.sub(r"<[^>]+>", " | ", line)
        line = re.sub(r"https?://\S+", " ", line)
        line = line.replace("**", "").replace("__", "")
        line = re.sub(r"(?<![A-Za-z0-9])[*_]|[*_](?![A-Za-z0-9])", "", line)
        line = PRODUCT.sub(" qqproductqq ", line)
        if is_table or "|" in line:
            for cell in line.split("|"):
                out.append((number,""))
                out.append((number,cell))
            out.append((number,""))
            continue
        out.append((number,line if s else ""))
        if s.startswith("#"):
            out.append((number,""))
    return out


TOKEN = re.compile(r"qq(code|product)qq|[A-Za-z][A-Za-z0-9]*(?:['’\-][A-Za-z0-9]+)*|\d+(?:[.,]\d+)*|[,;:()—–]|[.!?]+")
ABBREVIATIONS = [(re.compile(r"\be\.g\.", re.I), "eg"), (re.compile(r"\bi\.e\.", re.I), "ie"),
                 (re.compile(r"\bvs\.", re.I), "vs"), (re.compile(r"\betc\.(?=\s+[a-z])"), "etc")]
PUNCT = set(",;:()—–")


def sentences(lines):
    """Return (tokens, line_number) for each sentence."""
    result, cur, first_line = [], [], None

    def flush():
        nonlocal cur, first_line
        if any(t not in PUNCT for t in cur):
            result.append((cur, first_line))
        cur, first_line = [], None

    for line_number, text in lines:
        if not text:
            flush()
            continue
        text = text.replace(" - ", " – ").replace(" -- ", " — ")
        for rx, replacement in ABBREVIATIONS:
            text = rx.sub(replacement, text)
        for m in TOKEN.finditer(text):
            tok = m.group(0)
            if m.group(1):
                tok = m.group(1).upper()
            elif tok[0] in ".!?":
                flush()
                continue
            elif tok[0].isdigit():
                tok = "NUM"
            elif tok not in PUNCT:
                tok = tok.lower().replace("’", "'")
            if first_line is None:
                first_line = line_number
            cur.append(tok)
    flush()
    return result


def sentence_hits(tokens):
    """Return the group names that a sentence counts for, one entry for each use."""
    text = " ".join(tokens)
    words = sum(1 for t in tokens if t not in PUNCT)
    hits = []
    for name, rx in GROUP_RX.items():
        hits += [f"{name}:{m}" for m in rx.findall(text)]
    if words >= 6 and LIST3.search(text):
        hits.append("list")
    return hits, words, text


def score(path):
    counts = {name: 0 for name in GROUPS}
    counts["list"] = 0
    words = 0
    for tokens, _ in sentences(md_lines(path)):
        hits, n, _ = sentence_hits(tokens)
        words += n
        for h in hits:
            counts[h.split(":")[0]] += 1
    k = max(words, 1) / 1000
    limits = {name: limit for name, (limit, _) in GROUPS.items()}
    limits["list"] = LIST_LIMIT
    excess = sum(max(0.0, counts[g] - limits[g] * k) for g in counts)
    rate = sum(counts.values()) / k
    over = rate > TOTAL_LIMIT or excess > EXCESS_ALLOWED
    return {"page": os.path.basename(path), "words": words, "rate": rate, "excess": excess,
            "groups": {g: counts[g] / k for g in counts}, "over": over, "lead": len(lead_ins(path))}


def print_hits(path):
    rows = []
    for tokens, line_number in sentences(md_lines(path)):
        hits, _, text = sentence_hits(tokens)
        if hits:
            rows.append((line_number, ", ".join(hits), text))
    rows += [(line_number, "lead", text) for line_number, text in lead_ins(path)]
    for line_number, labels, text in sorted(rows, key=lambda row: row[0]):
        print(f"{path}:{line_number}  [{labels}]  {text[:140]}")


def main():
    parser = argparse.ArgumentParser(description="Score docs pages against the AGENTS.md Natural Phrasing limits.")
    parser.add_argument("pages", nargs="*", help="Markdown pages to score. Default: all pages in docs/.")
    parser.add_argument("--hits", action="store_true", help="List each sentence that counts, with its line number.")
    args = parser.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ranking = not args.pages
    pages = args.pages or sorted(
        os.path.join(root, "docs", f) for f in os.listdir(os.path.join(root, "docs")) if f.endswith((".md", ".mdx")))

    if args.hits:
        for page in pages:
            print_hits(page)
        return 0

    rows = [score(p) for p in pages]
    if ranking:
        short = [r for r in rows if r["words"] < MIN_WORDS]
        rows = [r for r in rows if r["words"] >= MIN_WORDS]
    rows.sort(key=lambda r: -r["rate"])

    names = list(GROUPS) + ["list"]
    print("%-36s %6s %6s %6s | %s | %4s | %s" % ("page", "words", "rate", "excess",
                                                 " ".join("%6s" % n for n in names), "lead", "status"))
    limits = [GROUPS[n][0] if n in GROUPS else LIST_LIMIT for n in names]
    print("%-36s %6s %6.1f %6d | %s | %4d |" % ("(limits)", "", TOTAL_LIMIT, EXCESS_ALLOWED,
                                               " ".join("%6.1f" % l for l in limits), 0))
    for r in rows:
        # OVER: the page is over the Natural Phrasing limits. LEAD: the page has a list lead-in.
        status = "+".join((["OVER"] if r["over"] else []) + (["LEAD"] if r["lead"] else [])) or "ok"
        if r["words"] < MIN_WORDS:
            status += " (short page)"
        print("%-36s %6d %6.1f %6.0f | %s | %4d | %s" % (r["page"][:36], r["words"], r["rate"], r["excess"],
                                                        " ".join("%6.1f" % r["groups"][n] for n in names),
                                                        r["lead"], status))
    over = [r for r in rows if r["over"]]
    lead = [r for r in rows if r["lead"]]
    if ranking:
        print(f"\n{len(rows)} pages ranked, {len(over)} over the limits, {len(lead)} with list lead-ins, "
              f"{len(short)} under {MIN_WORDS} words not ranked.")
    return 1 if over or lead else 0


if __name__ == "__main__":
    sys.exit(main())
