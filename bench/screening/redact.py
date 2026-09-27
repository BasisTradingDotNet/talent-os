#!/usr/bin/env python3
"""Strip identity and protected-characteristic signals from extracted CV text before it reaches
the model.

Removes or masks: the name header (and later occurrences of the name), emails, phone numbers,
social-profile URLs, DOB / age, gender, marital status, religion / caste / community lines,
family-member names, ID numbers, salutations and photo references. Everything else is left
byte-for-byte intact so the model can quote it verbatim.

    python3 redact.py cvs/001.md            # print the redacted text
    python3 redact.py --report cvs/001.md   # also print what was removed

Known gaps (documented, not hidden): third-person pronouns (he/she) are not neutralised; names of
referees or managers are not removed; nationality and languages are kept because the job's
knockouts may legitimately need work-authorisation facts.
"""
import re
import sys
from typing import Dict, List, Optional, Tuple

NAME_TOKEN = "[NAME]"
EMAIL_TOKEN = "[EMAIL]"
PHONE_TOKEN = "[PHONE]"
URL_TOKEN = "[URL]"
REDACTED_TOKEN = "[REDACTED]"

# --- name header -------------------------------------------------------------------------------

_PARTICLES = {"de", "van", "der", "den", "bin", "binti", "al", "el", "da", "di", "do", "dos", "la",
              "le", "von", "du", "ibn", "abu"}
_NAME_STOP = {
    "curriculum", "vitae", "resume", "résumé", "cv", "summary", "profile", "professional",
    "experience", "objective", "skills", "education", "contact", "personal", "details", "quant",
    "quantitative", "trader", "engineer", "developer", "analyst", "senior", "junior", "cover",
    "letter", "dear", "hiring", "manager", "work", "employment", "technical", "about", "career",
    "candidate", "application", "applicant", "position", "role", "name", "email", "phone",
    "mobile", "address", "linkedin", "github", "the", "and", "for", "with", "sir", "madam",
    "team", "desk", "trading", "software", "data", "scientist", "researcher", "intern",
}
_NAME_LABEL = (r"(?:surname\(?s?\)?\s*/\s*first\s+name\(?s?\)?|first\s+name\(?s?\)?\s*/\s*surname\(?s?\)?|"
               r"full\s+name|candidate\s+name|name)")
_HEADER_PREFIX = re.compile(
    r"^\s*(?:curriculum\s+vitae|c\.?v\.?|r[ée]sum[ée]|" + _NAME_LABEL + r")\s*[:\-–—|]?\s*", re.IGNORECASE)
_SALUTATION = re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Mx|Shri|Smt|Dr|Kumari)\.?\s+(?=\[NAME\]|[A-Z])")


def _name_tokens_ok(tokens: List[str]) -> bool:
    if not 2 <= len(tokens) <= 5:
        return False
    if any(any(ch.isdigit() for ch in t) for t in tokens):
        return False
    if any(t.lower().strip(".") in _NAME_STOP for t in tokens):
        return False
    caps = 0
    for t in tokens:
        low = t.lower()
        if low in _PARTICLES:
            continue
        if re.fullmatch(r"[A-Z]\.?", t):          # initial
            caps += 1
            continue
        if re.fullmatch(r"[A-Z][a-z'’\-]+(?:[A-Z][a-z'’\-]+)*\.?", t):  # Priya, O'Neil, Al-Rashid
            caps += 1
            continue
        if re.fullmatch(r"[A-Z][A-Z'’\-]+", t):  # ALL CAPS
            caps += 1
            continue
        return False
    return caps >= 2


def _looks_like_contact(line: str) -> bool:
    return bool(_EMAIL.search(line) or _SOCIAL_URL.search(line) or _PHONE_INTL.search(line)
                or _PHONE_BARE.search(line) or _PHONE_LABELLED.search(line))


def _name_from_line(raw: str) -> Optional[str]:
    line = raw.strip().strip("#*_| ").strip()
    line = _HEADER_PREFIX.sub("", line)
    # two-column / inline contact headers: take the first cell
    cell = re.split(r"\s*[|•·]\s*|\t| {2,}| [-–—] ", line)[0].strip().strip("*_")
    if re.fullmatch(r"[A-Z][\w'’\-]+,\s*[A-Z][\w'’\-]+(?:\s+[A-Z][\w'’\-]+)?", cell):
        cell = cell.replace(",", " ")               # Europass "Kulkarni, Rohit"
    cell = re.sub(r"\s*[,(].*$", "", cell)         # "Priya Raghunathan, CFA" / "(she/her)"
    cell = cell.strip(" :—–-")
    tokens = cell.split()
    if _name_tokens_ok(tokens):
        return " ".join(tokens)
    return None


def detect_name(text: str) -> Optional[str]:
    """Find the candidate's name: a name-like line in the header (first eight non-empty lines),
    a name-like line immediately followed by contact details (CVs that start with a cover
    letter), or a 'Name:' field anywhere."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    for raw in lines[:8]:
        found = _name_from_line(raw)
        if found:
            return found
    for i, raw in enumerate(lines[8:], start=8):
        found = _name_from_line(raw)
        if found and any(_looks_like_contact(nxt) for nxt in lines[i + 1:i + 4]):
            return found
    m = re.search(r"(?im)^\s*[-*•|]?\s*" + _NAME_LABEL + r"\s*[:\-–—|]\s*([^\n|•·]+)", text)
    if m:
        found = _name_from_line(m.group(1))
        if found:
            return found
    return None


def _mask_name(text: str, name: str) -> str:
    text = re.sub(re.escape(name), NAME_TOKEN, text, flags=re.IGNORECASE)
    for tok in name.split():
        bare = tok.strip(".'’")
        if len(bare) < 3 or bare.lower() in _PARTICLES:
            continue
        for form in sorted({bare, bare.upper(), bare.capitalize(), bare.title()}):
            text = re.sub(r"(?<![\w\[])%s(?![\w\]])" % re.escape(form), NAME_TOKEN, text)
    text = re.sub(r"(?:\[NAME\][\s.,]*){2,}", NAME_TOKEN + " ", text)
    return text


# --- contact details ---------------------------------------------------------------------------

_EMAIL = re.compile(r"[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+")
_SOCIAL_URL = re.compile(
    r"(?i)(?:https?://)?(?:www\.)?(?:linkedin\.com|github\.com|twitter\.com|x\.com|facebook\.com|"
    r"instagram\.com|t\.me|telegram\.me)/[^\s|)>\]]+")
_PHONE_LABELLED = re.compile(
    r"(?i)\b(?:phone|mobile|mob|tel|telephone|cell|contact(?:\s+no)?|whatsapp|ph)\b\.?\s*"
    r"(?:no\.?|number|#)?\s*[:\-–—]?\s*(\+?\(?\d[\d\s().\-]{6,}\d)")
_PHONE_INTL = re.compile(r"\+\d{1,3}[\s\-.]?(?:\(?\d+\)?[\s\-.]?){1,5}\d")
_PHONE_BARE = re.compile(
    r"(?<!\d)(?:0\d{9,10}|[6-9]\d{9}|\d{5}[\s\-]\d{5}|0\d{4}\s\d{6}|\(\d{3}\)\s?\d{3}[\s.\-]\d{4}|"
    r"\d{3}[\s.\-]\d{3}[\s.\-]\d{4})(?!\d)")


def _digits(s: str) -> int:
    return sum(ch.isdigit() for ch in s)


def _mask_phones(text: str) -> Tuple[str, int]:
    count = 0

    def labelled(m: "re.Match[str]") -> str:
        nonlocal count
        num = m.group(1)
        if _digits(num) < 8:
            return m.group(0)
        count += 1
        return m.group(0)[: m.start(1) - m.start(0)] + PHONE_TOKEN

    text = _PHONE_LABELLED.sub(labelled, text)

    def intl(m: "re.Match[str]") -> str:
        nonlocal count
        if _digits(m.group(0)) < 9:
            return m.group(0)
        count += 1
        return PHONE_TOKEN

    text = _PHONE_INTL.sub(intl, text)

    def bare(m: "re.Match[str]") -> str:
        nonlocal count
        count += 1
        return PHONE_TOKEN

    text = _PHONE_BARE.sub(bare, text)
    return text, count


# --- protected characteristics ------------------------------------------------------------------

_LABELS = (
    r"(?:"
    r"date\s+of\s+birth|d\.?\s?o\.?\s?b\.?|birth\s*date|birthday|born|age|"
    r"gender|sex|"
    r"marital\s+status|marital|married|spouse|husband|wife|civil\s+status|"
    r"religion|religious|faith|"
    r"caste|sub-?caste|category|community|reservation|"
    r"father'?s?\s+name|mother'?s?\s+name|husband'?s?\s+name|parent'?s?\s+name|guardian'?s?\s+name|"
    r"passport(?:\s+no\.?|\s+number)?|aadha?ar(?:\s+no\.?)?|pan(?:\s+no\.?|\s+card)?|"
    r"national\s+insurance|ni\s+number|ssn|voter\s+id|"
    r"photo(?:graph)?|picture|headshot|passport[\s\-]size"
    r")"
)
# "Label: value", "Label – value", "Label - value" (hyphen only when spaced, so "Pan-European" survives)
_SENSITIVE_LABEL = re.compile(r"(?i)^\s*[-*•·]?\s*" + _LABELS + r"\s*(?::|–|—|\s-\s)")
# a bare label on its own (first cell of a markdown table row)
_SENSITIVE_BARE = re.compile(r"(?i)^\s*" + _LABELS + r"\s*:?\s*$")
_SENSITIVE_VALUE = {
    "male", "female", "m", "f", "single", "married", "unmarried", "divorced", "widowed", "widow",
    "hindu", "muslim", "christian", "sikh", "jain", "buddhist", "parsi", "jewish", "atheist",
    "obc", "sc", "st", "general", "ews", "brahmin", "dalit", "nt", "vjnt", "sebc",
}
_PHOTO = re.compile(r"(?i)\b(?:photo|photograph|headshot|passport[\s\-]size(?:\s+photo)?)\b|\b[\w\-]+\.(?:jpe?g|png|gif)\b")
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
# "…; Caste: OBC, Religion: Hindu" written inline after a separator
_INLINE_LABELLED = re.compile(r"(?i)\s*[;,]\s*" + _LABELS + r"\s*:\s*[^;|,\n]+")
_INLINE_AGE = re.compile(r"(?i)\b(?:aged?|age:?)\s*[:\-–]?\s*\d{2}\b|\b\d{2}\s*(?:years?|yrs?)[\s\-]*old\b")
_INLINE_BORN = re.compile(r"(?i)\bborn\b[^.\n]{0,40}?\b(?:19|20)\d{2}\b")
_CELL_SPLIT = re.compile(r"(\s*\|\s*|\t| {2,}|\s+[•·]\s+)")


def _clean_cells(line: str) -> Tuple[Optional[str], int]:
    """Drop sensitive cells from a line. Returns (new_line or None if nothing left, removed)."""
    if line.strip().startswith("|"):
        # markdown table row: a bare sensitive label in the first cell drops the whole row
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and _SENSITIVE_BARE.match(cells[0]) and len(cells) > 1:
            return None, len(cells)
    parts = _CELL_SPLIT.split(line)
    cells = parts[0::2]
    seps = parts[1::2]
    first = next((c.strip().strip("-*•·").strip() for c in cells if c.strip()), "")
    if first and _SENSITIVE_BARE.match(first) and sum(1 for c in cells if c.strip()) > 1:
        return None, len(cells)  # two-column "Gender | Male", "Date of Birth   3 May 1996": drop the whole line
    keep: List[str] = []
    removed = 0
    for cell in cells:
        bare = cell.strip().strip("-*•·").strip()
        if not bare:
            keep.append(cell)
            continue
        if _SENSITIVE_LABEL.match(bare) or _SENSITIVE_BARE.match(bare) \
                or bare.lower().rstrip(".") in _SENSITIVE_VALUE \
                or _MD_IMAGE.search(bare) or _PHOTO.search(bare) and len(bare) < 60:
            removed += 1
            continue
        keep.append(cell)
    if removed == 0:
        return line, 0
    if not any(c.strip().strip("|-*•·").strip() for c in keep):
        return None, removed
    sep = " | " if "|" in "".join(seps) else "  "
    out = sep.join(c.strip() for c in keep if c.strip().strip("|").strip())
    # markdown table rows: keep leading/trailing pipes
    if line.strip().startswith("|"):
        out = "| " + out + " |"
    return out, removed


# --- public API ---------------------------------------------------------------------------------

def redact_report(text: str) -> Tuple[str, Dict[str, int]]:
    report: Dict[str, int] = {"name": 0, "email": 0, "phone": 0, "url": 0, "sensitive_cells": 0,
                              "dropped_lines": 0, "inline": 0}
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    name = detect_name(text)

    text, n = _EMAIL.subn(EMAIL_TOKEN, text)
    report["email"] = n
    text, n = _SOCIAL_URL.subn(URL_TOKEN, text)
    report["url"] = n
    text, n = _mask_phones(text)
    report["phone"] = n
    text, n = _MD_IMAGE.subn("", text)
    report["inline"] += n

    out_lines: List[str] = []
    for line in text.split("\n"):
        new, removed = _clean_cells(line)
        report["sensitive_cells"] += removed
        if new is None:
            report["dropped_lines"] += 1
            continue
        out_lines.append(new)
    text = "\n".join(out_lines)

    text, n = _INLINE_LABELLED.subn("", text)
    report["inline"] += n
    text, n = _INLINE_AGE.subn(REDACTED_TOKEN, text)
    report["inline"] += n
    text, n = _INLINE_BORN.subn(REDACTED_TOKEN, text)
    report["inline"] += n

    if name:
        before = text.count(NAME_TOKEN)
        text = _mask_name(text, name)
        report["name"] = text.count(NAME_TOKEN) - before
    text, n = _SALUTATION.subn("", text)
    report["inline"] += n

    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
    return text, report


def redact(text: str) -> str:
    return redact_report(text)[0]


def main(argv: List[str]) -> int:
    show = "--report" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if not paths:
        print(__doc__)
        return 2
    for path in paths:
        with open(path, "r", encoding="utf-8") as fh:
            text, report = redact_report(fh.read())
        sys.stdout.write(text)
        if show:
            sys.stdout.write("\n--- redaction report: %s\n" % report)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
