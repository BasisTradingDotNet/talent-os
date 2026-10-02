#!/usr/bin/env python3
"""Shared rules for the screening benchmark: rubric loading, the deterministic tier rule and
validation of model output against schema.json.

Tier rule (also documented in rubric.json -> tier_rule), checked in order:

    total = sum of the six criterion scores; a null (unknown) score counts as 0
    core  = trading_experience, python, derivatives

    Unlikely  if any core score == 0 (including unknown)  OR  total <= 6
    Strong    if every core score >= 2  AND  risk >= 2  AND  total >= 12
    Possible  otherwise

The model never emits a tier. Code derives it from the criterion scores, so the tier is
reproducible and the model's only job is scoring with evidence.
"""
import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
RUBRIC_PATH = os.path.join(HERE, "rubric.json")
SCHEMA_PATH = os.path.join(HERE, "schema.json")
PROMPT_PATH = os.path.join(HERE, "prompt.md")

TIERS = ["Strong", "Possible", "Unlikely"]
CORE = ["trading_experience", "python", "derivatives"]
CRITERIA = ["trading_experience", "python", "derivatives", "risk", "tooling", "rust_lowlat"]
EMPLOYER_TYPES = [
    "prop_shop", "market_maker", "broker", "crypto_native", "hedge_fund", "bank",
    "exchange", "fintech", "other", "none",
]

STRONG_TOTAL = 12
UNLIKELY_TOTAL = 6


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_rubric() -> Dict[str, Any]:
    return load_json(RUBRIC_PATH)


def load_schema() -> Dict[str, Any]:
    return load_json(SCHEMA_PATH)


def score_or_zero(value: Optional[int]) -> int:
    return 0 if value is None else int(value)


def derive_tier(scores: Dict[str, Optional[int]]) -> str:
    """Deterministic tier from a {criterion_id: score|None} mapping. Missing keys count as 0."""
    s = {c: score_or_zero(scores.get(c)) for c in CRITERIA}
    total = sum(s.values())
    if any(s[c] == 0 for c in CORE) or total <= UNLIKELY_TOTAL:
        return "Unlikely"
    if all(s[c] >= 2 for c in CORE) and s["risk"] >= 2 and total >= STRONG_TOTAL:
        return "Strong"
    return "Possible"


def scores_from_output(output: Dict[str, Any]) -> Dict[str, Optional[int]]:
    """Extract {criterion_id: score|None} from a validated model output."""
    out: Dict[str, Optional[int]] = {}
    for item in output.get("criteria", []):
        out[item["id"]] = item.get("score")
    return out


def rubric_text(rubric: Dict[str, Any]) -> str:
    """Render the rubric for the prompt."""
    lines: List[str] = []
    for crit in rubric["criteria"]:
        tag = "core" if crit.get("core") else ("bonus" if crit["id"] == "rust_lowlat" else "supporting")
        lines.append("### %s — %s (%s)" % (crit["id"], crit["name"], tag))
        for k in ("0", "1", "2", "3"):
            lines.append("- %s: %s" % (k, crit["anchors"][k]))
        lines.append("")
    return "\n".join(lines).rstrip()


def prompt_version() -> str:
    """Hash of prompt.md + rubric.json + schema.json so every result records what produced it."""
    h = hashlib.sha256()
    for path in (PROMPT_PATH, RUBRIC_PATH, SCHEMA_PATH):
        with open(path, "rb") as fh:
            h.update(fh.read())
        h.update(b"\0")
    return "sha256:" + h.hexdigest()[:16]


# ---------------------------------------------------------------------------------------------
# Output validation (stdlib only; mirrors schema.json closely enough for the benchmark)
# ---------------------------------------------------------------------------------------------

def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_output(obj: Any) -> Tuple[bool, List[str]]:
    """Return (ok, problems). ok means the object matches schema.json structurally."""
    problems: List[str] = []
    if not isinstance(obj, dict):
        return False, ["top-level is not an object"]

    for key in ("facts", "criteria", "summary", "flags"):
        if key not in obj:
            problems.append("missing key: %s" % key)
    if problems:
        return False, problems

    facts = obj["facts"]
    if not isinstance(facts, dict):
        problems.append("facts is not an object")
    else:
        for key in ("years_experience", "current_employer_type", "notice_period_days",
                    "expected_ctc_lpa", "location"):
            if key not in facts:
                problems.append("facts missing key: %s" % key)
        ye = facts.get("years_experience")
        if ye is not None and not _is_number(ye):
            problems.append("facts.years_experience must be number or null")
        et = facts.get("current_employer_type")
        if et is not None and et not in EMPLOYER_TYPES:
            problems.append("facts.current_employer_type not in enum: %r" % (et,))
        npd = facts.get("notice_period_days")
        if npd is not None and not (isinstance(npd, int) and not isinstance(npd, bool)):
            problems.append("facts.notice_period_days must be integer or null")
        ctc = facts.get("expected_ctc_lpa")
        if ctc is not None and not _is_number(ctc):
            problems.append("facts.expected_ctc_lpa must be number or null")
        loc = facts.get("location")
        if loc is not None and not isinstance(loc, str):
            problems.append("facts.location must be string or null")

    criteria = obj["criteria"]
    if not isinstance(criteria, list):
        problems.append("criteria is not a list")
    else:
        seen: List[str] = []
        for i, item in enumerate(criteria):
            if not isinstance(item, dict):
                problems.append("criteria[%d] is not an object" % i)
                continue
            cid = item.get("id")
            if cid not in CRITERIA:
                problems.append("criteria[%d].id unknown: %r" % (i, cid))
            else:
                seen.append(cid)
            sc = item.get("score", "missing")
            if sc == "missing":
                problems.append("criteria[%d].score missing" % i)
            elif sc is not None and not (isinstance(sc, int) and not isinstance(sc, bool) and 0 <= sc <= 3):
                problems.append("criteria[%d].score must be 0-3 or null" % i)
            ev = item.get("evidence", "missing")
            if ev == "missing":
                problems.append("criteria[%d].evidence missing" % i)
            elif ev is not None and not isinstance(ev, str):
                problems.append("criteria[%d].evidence must be string or null" % i)
            if sc is None and isinstance(ev, str) and ev.strip():
                # unknown with a quote is contradictory but tolerated; flag it
                problems.append("criteria[%d]: score null but evidence given (soft)" % i)
        if sorted(seen) != sorted(CRITERIA):
            problems.append("criteria ids must be exactly %s once each, got %s" % (CRITERIA, seen))

    summary = obj["summary"]
    if not isinstance(summary, str):
        problems.append("summary must be a string")

    flags = obj["flags"]
    if not isinstance(flags, list) or not all(isinstance(f, str) for f in flags):
        problems.append("flags must be a list of strings")

    hard = [p for p in problems if not p.endswith("(soft)")]
    return (len(hard) == 0), problems


def parse_output(raw: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Parse model text into JSON. Tolerates code fences and leading/trailing prose."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        return json.loads(text), None
    except json.JSONDecodeError as exc:
        first, last = text.find("{"), text.rfind("}")
        if first != -1 and last > first:
            try:
                return json.loads(text[first:last + 1]), None
            except json.JSONDecodeError as exc2:
                return None, str(exc2)
        return None, str(exc)


if __name__ == "__main__":  # tiny self-check
    assert derive_tier({"trading_experience": 3, "python": 3, "derivatives": 3, "risk": 2, "tooling": 3, "rust_lowlat": 1}) == "Strong"
    assert derive_tier({"trading_experience": 2, "python": 2, "derivatives": 2, "risk": 2, "tooling": 2, "rust_lowlat": 0}) == "Possible"
    assert derive_tier({"trading_experience": 0, "python": 3, "derivatives": 3, "risk": 3, "tooling": 3, "rust_lowlat": 3}) == "Unlikely"
    assert derive_tier({"trading_experience": None, "python": 2, "derivatives": 2}) == "Unlikely"
    print("rules ok; prompt_version", prompt_version())
