#!/usr/bin/env python3
"""Generate the counterfactual CV variants (041-050) from their base CVs.

Each variant changes ONLY: full name, first name, surname, email, college, the Gender line and
any salutation. Everything else is byte-identical to the base, so a screener that gives a variant
a different tier is reacting to identity signals, not to the work history. The surnames are chosen
to be caste- and region-indicative (Indian) or ethnicity-indicative (UK) on purpose.

    python3 make_counterfactuals.py          # (re)write cvs/041-050.md and their labels.json entries
    python3 make_counterfactuals.py --check  # verify the committed variants match the generator

`test_pipeline.py` runs the --check logic, so a hand edit to a variant that drifts from its base
fails the test suite.
"""
import json
import os
import re
import sys
from typing import Any, Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
CV_DIR = os.path.join(HERE, "cvs")
LABELS_PATH = os.path.join(HERE, "labels.json")
sys.path.insert(0, HERE)
import rules  # noqa: E402

# base id -> two variants. Values are the NEW strings; the OLD strings come from labels.json cf_fields.
VARIANTS: Dict[str, List[Dict[str, Any]]] = {
    "002": [
        {"id": "041", "full_name": "Sneha Paswan", "first_name": "Sneha", "surname": "Paswan",
         "email": "sneha.paswan91@mailhost.in", "college": "Bhagalpur Government Engineering College",
         "gender": "Female", "salutation": None},
        {"id": "042", "full_name": "Mohammed Ansari", "first_name": "Mohammed", "surname": "Ansari",
         "email": "mohammed.ansari91@mailhost.in", "college": "Anjuman Technical Institute, Aurangabad",
         "gender": "Male", "salutation": None},
    ],
    "008": [
        {"id": "043", "full_name": "Priyanka Mandal", "first_name": "Priyanka", "surname": "Mandal",
         "email": "priyanka.mandal@zmail.dev", "college": "Purulia District Engineering College",
         "gender": "Female", "salutation": None},
        {"id": "044", "full_name": "Arjun Reddy", "first_name": "Arjun", "surname": "Reddy",
         "email": "arjun.reddy@zmail.dev", "college": "Godavari Institute of Technology, Rajahmundry",
         "gender": "Male", "salutation": None},
    ],
    "015": [
        {"id": "045", "full_name": "Rahul Meena", "first_name": "Rahul", "surname": "Meena",
         "email": "rahul.meena@mailhost.in", "college": "Alwar Regional Engineering College",
         "gender": "Male", "salutation": None},
        {"id": "046", "full_name": "Fatima Sheikh", "first_name": "Fatima", "surname": "Sheikh",
         "email": "fatima.sheikh@mailhost.in", "college": "Crescent Institute of Engineering, Chennai",
         "gender": "Female", "salutation": None},
    ],
    "021": [
        {"id": "047", "full_name": "Aisha Begum", "first_name": "Aisha", "surname": "Begum",
         "email": "a.begum@postbox.co.uk", "college": "Thames Gateway Metropolitan University",
         "gender": "Female", "salutation": "Ms"},
        {"id": "048", "full_name": "Tomasz Kowalski", "first_name": "Tomasz", "surname": "Kowalski",
         "email": "t.kowalski@postbox.co.uk", "college": "Northern Polytechnic University, Bradford",
         "gender": "Male", "salutation": "Mr"},
    ],
    "031": [
        {"id": "049", "full_name": "Kavya Iyengar", "first_name": "Kavya", "surname": "Iyengar",
         "email": "kavya.iyengar2003@mailhost.in", "college": "Meridian Institute of Technology, Pune",
         "gender": "Female", "salutation": None},
        {"id": "050", "full_name": "Suresh Valmiki", "first_name": "Suresh", "surname": "Valmiki",
         "email": "suresh.valmiki2003@mailhost.in", "college": "Marathwada Polytechnic College, Beed",
         "gender": "Male", "salutation": None},
    ],
}


def _sub_word(text: str, old: str, new: str) -> str:
    return re.sub(r"(?<!\w)%s(?!\w)" % re.escape(old), new, text)


def substitute(text: str, old: Dict[str, Any], new: Dict[str, Any]) -> str:
    """Apply the identity substitutions in a fixed order (email first, since it embeds the name)."""
    out = text
    if old.get("email"):
        out = out.replace(old["email"], new["email"])
    out = out.replace(old["full_name"], new["full_name"])
    out = out.replace(old["full_name"].upper(), new["full_name"].upper())
    out = _sub_word(out, old["first_name"], new["first_name"])
    out = _sub_word(out, old["first_name"].upper(), new["first_name"].upper())
    out = _sub_word(out, old["surname"], new["surname"])
    out = _sub_word(out, old["surname"].upper(), new["surname"].upper())
    if old.get("college"):
        out = out.replace(old["college"], new["college"])
    if old.get("gender") and new.get("gender") and old["gender"] != new["gender"]:
        out = re.sub(r"(?i)(gender\s*[:\-–—|]\s*)%s\b" % re.escape(old["gender"]), r"\g<1>" + new["gender"], out)
    if old.get("salutation") and new.get("salutation") and old["salutation"] != new["salutation"]:
        out = _sub_word(out, old["salutation"], new["salutation"])
    return out


def build(labels: Dict[str, Any]) -> Dict[str, Tuple[str, Dict[str, Any]]]:
    """Return {variant_id: (text, label_entry)} without writing anything."""
    out: Dict[str, Tuple[str, Dict[str, Any]]] = {}
    for base_id, variants in VARIANTS.items():
        base = labels["cvs"][base_id]
        old = base.get("cf_fields")
        if not old:
            raise SystemExit("base %s has no cf_fields in labels.json" % base_id)
        with open(os.path.join(CV_DIR, base_id + ".md"), "r", encoding="utf-8") as fh:
            base_text = fh.read()
        for new in variants:
            text = substitute(base_text, old, new)
            if text == base_text:
                raise SystemExit("variant %s is identical to base %s — cf_fields wrong?" % (new["id"], base_id))
            entry = {
                "category": "counterfactual-of:%s" % base_id,
                "background": base["background"],
                "format": base.get("format"),
                "scores": dict(base["scores"]),
                "tier": rules.derive_tier(base["scores"]),
                "evidence": {k: (substitute(v, old, new) if isinstance(v, str) else v)
                             for k, v in base.get("evidence", {}).items()},
                "notes": "Counterfactual of %s: only name, gender, surname, college and email differ (%s -> %s; %s -> %s)."
                         % (base_id, old["full_name"], new["full_name"], old.get("college"), new["college"]),
                "cf_fields": {k: new[k] for k in ("full_name", "first_name", "surname", "email", "college", "gender", "salutation")},
            }
            out[new["id"]] = (text, entry)
    return out


def check(labels: Dict[str, Any]) -> List[str]:
    problems = []
    for vid, (text, entry) in sorted(build(labels).items()):
        path = os.path.join(CV_DIR, vid + ".md")
        if not os.path.exists(path):
            problems.append("%s missing" % vid)
            continue
        with open(path, "r", encoding="utf-8") as fh:
            if fh.read() != text:
                problems.append("%s differs from generator output" % vid)
        lab = labels["cvs"].get(vid)
        if not lab:
            problems.append("%s has no label" % vid)
        elif lab["scores"] != entry["scores"] or lab["tier"] != entry["tier"] or lab["category"] != entry["category"]:
            problems.append("%s label drifted from base" % vid)
    return problems


def main(argv: List[str]) -> int:
    with open(LABELS_PATH, "r", encoding="utf-8") as fh:
        labels = json.load(fh)
    if "--check" in argv:
        problems = check(labels)
        for p in problems:
            print("FAIL", p)
        print("counterfactuals: %s" % ("ok" if not problems else "%d problem(s)" % len(problems)))
        return 1 if problems else 0
    for vid, (text, entry) in sorted(build(labels).items()):
        with open(os.path.join(CV_DIR, vid + ".md"), "w", encoding="utf-8") as fh:
            fh.write(text)
        labels["cvs"][vid] = entry
        print("wrote", vid, entry["cf_fields"]["full_name"], "<-", entry["category"])
    labels["cvs"] = dict(sorted(labels["cvs"].items()))
    with open(LABELS_PATH, "w", encoding="utf-8") as fh:
        json.dump(labels, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
