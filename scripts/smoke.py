#!/usr/bin/env python3
"""End-to-end smoke test against a running talent-os stack.

Creates a throwaway candidate named "Smoke Test", so run it against staging or wipe afterwards.

    BASE=http://localhost:8170 python3 scripts/smoke.py

It walks every candidate-view section of the active kit: it presents each question and checks that
the public candidate payload contains only allowlisted keys and none of the kit's secret text
(titles, model answers, rubrics, trap notes, "what good looks like"). The allowlist check is the
point of the script.
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("BASE", "http://localhost:8170").rstrip("/")
EMAIL = os.environ.get("EMAIL", "smoke@basistrading.net")
AUTH = {"cf-access-authenticated-user-email": EMAIL}

STATE_KEYS = {"phase", "orgName", "sectionLabel", "instructions", "question", "presentedAt", "serverNow", "version"}
QUESTION_KEYS = {"position", "total", "prompt", "dataset", "code", "timeMinutes"}

failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def call(method, path, body=None, auth=True, expect=200):
    req = urllib.request.Request(BASE + path, method=method)
    if auth:
        for k, v in AUTH.items():
            req.add_header(k, v)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=15) as r:
            raw = r.read().decode()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode(), e.code
    ok = (200 <= status < 300) if expect < 300 else status == expect
    if not ok:
        raise AssertionError(f"{method} {path} → {status} (expected {expect}): {raw[:300]}")
    ctype_json = raw[:1] in "{["
    return json.loads(raw) if ctype_json else raw


def secrets_of(questions):
    out = set()
    for q in questions:
        for field in ("title", "modelAnswer", "trapOrBonus", "whatGoodLooksLike"):
            v = q.get(field)
            if v and len(v) >= 8:
                out.add(v)
        for v in (q.get("rubric") or {}).values():
            if v and len(v) >= 12:
                out.add(v)
    return out


def main():
    check("health", call("GET", "/api/health", auth=False).get("ok") is True)
    me = call("GET", "/api/me")
    check("me", me.get("email") == EMAIL, json.dumps(me))

    kit = call("GET", "/api/kit")
    by_key = {q["key"]: q for q in kit["questions"]}
    counts = {s["key"]: len(s["questionKeys"]) for s in kit["sections"]}
    print(f"kit {kit['slug']} v{kit['version']}: {counts}")
    secrets = secrets_of(kit["questions"])

    cand = call("POST", "/api/candidates", {"name": "Smoke Test", "source": "smoke"}, expect=201)
    cid = cand["id"]
    check("candidate created", cand["name"] == "Smoke Test")

    for section in [s for s in kit["sections"] if s["candidateView"]]:
        sk = section["key"]
        sess = call("POST", "/api/sessions", {"candidateId": cid, "section": sk}, expect=201)
        sid, url = sess["id"], sess["candidateUrl"]
        check(f"[{sk}] candidateUrl", bool(url) and "/c/" in url, str(url))
        token = url.rsplit("/c/", 1)[1]
        st = call("GET", f"/api/candidate/{token}/state", auth=False)
        check(f"[{sk}] waiting", st["phase"] == "waiting", st["phase"])
        call("POST", f"/api/sessions/{sid}/start", expect=201)
        st = call("GET", f"/api/candidate/{token}/state", auth=False)
        check(f"[{sk}] intro", st["phase"] == "intro" and (bool(st["instructions"]) == section["showInstructions"]))

        for i, qk in enumerate(section["questionKeys"]):
            call("POST", f"/api/sessions/{sid}/present", {"questionKey": qk}, expect=201)
            st = call("GET", f"/api/candidate/{token}/state", auth=False)
            blob = json.dumps(st)
            leaked = [s[:40] for s in secrets if s in blob]
            ok = (
                set(st) == STATE_KEYS
                and st["phase"] == "question"
                and set(st["question"]) == QUESTION_KEYS
                and st["question"]["position"] == i + 1
                and st["question"]["prompt"] == by_key[qk]["prompt"]
                and st["question"]["dataset"] == by_key[qk]["dataset"]
                and st["question"]["code"] == by_key[qk]["code"]
                and not leaked
            )
            check(f"[{sk}] {qk} candidate payload allowlisted, no leaks", ok, f"keys={sorted(st)} leaked={leaked}")
            score = 3 if i % 3 else 2
            call("PUT", f"/api/sessions/{sid}/responses/{qk}", {"score": score, "notes": "smoke", "trapNoticed": i == 0})

        sess = call("GET", f"/api/sessions/{sid}")
        v = sess["verdict"]
        expected_total = sum(3 if i % 3 else 2 for i in range(len(section["questionKeys"])))
        check(f"[{sk}] verdict", v["complete"] and v["total"] == expected_total and v["max"] == section["maxScore"],
              json.dumps(v))
        check(f"[{sk}] subtotals", len(v["subtotals"]) == len(section["domainGroups"]), json.dumps(v["subtotals"]))
        call("POST", f"/api/sessions/{sid}/end", expect=201)
        st = call("GET", f"/api/candidate/{token}/state", auth=False)
        check(f"[{sk}] ended", st["phase"] == "ended" and st["question"] is None)

    for section in [s for s in kit["sections"] if s["scoring"] == "dimensions"]:
        sk = section["key"]
        sess = call("POST", "/api/sessions", {"candidateId": cid, "section": sk}, expect=201)
        check(f"[{sk}] no candidate link", sess["candidateUrl"] is None)
        for d in section["dimensionIds"]:
            call("PUT", f"/api/sessions/{sess['id']}/ratings/{d}", {"rating": 4, "note": "smoke"})
        if section["recommendationOptions"]:
            sess = call("PATCH", f"/api/sessions/{sess['id']}", {"recommendation": section["recommendationOptions"][0]})
        check(f"[{sk}] ratings saved", len([r for r in sess["ratings"] if r["rating"] == 4]) == len(section["dimensionIds"]))

    call("GET", "/api/candidate/not-a-real-token/state", auth=False, expect=404)
    check("unknown token → 404", True)

    rows = call("GET", "/api/candidates")
    mine = [r for r in rows if r["id"] == cid]
    check("comparison row", bool(mine) and len(mine[0]["latest"]) >= 1)
    csv = call("GET", "/api/export/candidates.csv")
    check("csv export", "Smoke Test" in csv)
    sc = call("GET", f"/api/export/candidates/{cid}.json")
    check("json scorecard", sc["candidate"]["id"] == cid and len(sc["sessions"]) >= 1)

    print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
