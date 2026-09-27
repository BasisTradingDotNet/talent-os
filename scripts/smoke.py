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
import re
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("BASE", "http://localhost:8170").rstrip("/")
EMAIL = os.environ.get("EMAIL", "smoke@basistrading.net")
AUTH = {"cf-access-authenticated-user-email": EMAIL}

STATE_KEYS = {"phase", "orgName", "sectionLabel", "instructions", "question", "presentedAt", "serverNow", "version",
              "recording", "answer", "sectionEndsAt", "selfPaced", "answeredPositions", "marking", "market"}
QUESTION_KEYS = {"position", "total", "prompt", "dataset", "code", "timeMinutes", "choices"}

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
    ctype_json = bool(raw) and raw[0] in "{["
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


def call_raw(method, path, data, headers=None, auth=False, expect=200):
    """Raw-body request (recording chunks); returns (status, body bytes, headers)."""
    req = urllib.request.Request(BASE + path, method=method, data=data)
    if auth:
        for k, v in AUTH.items():
            req.add_header(k, v)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def recorded_flow(cid, section):
    """v1/v1.1: consent gate, chunk ordering, answers, events, extensions, protected playback."""
    sk = section["key"]
    sess = call("POST", "/api/sessions", {"candidateId": cid, "section": sk, "recordingRequired": True}, expect=201)
    sid, token = sess["id"], sess["candidateUrl"].rsplit("/c/", 1)[1]
    cand = f"/api/candidate/{token}"
    st = call("GET", f"{cand}/state", auth=False)
    rec = st["recording"]
    check("[rec] consent required before anything", rec["required"] and not rec["consentGiven"] and bool(rec["consentText"]))
    check("[rec] state keys", set(st) == STATE_KEYS and set(rec) == {"required", "consentGiven", "consentText"}, sorted(st))
    status, _, _ = call_raw("POST", f"{cand}/recordings", json.dumps({"stream": "camera", "mimeType": "video/webm"}).encode(),
                            {"content-type": "application/json"})
    check("[rec] recording refused before consent (409)", status == 409, str(status))
    st = call("POST", f"{cand}/consent", {"accepted": True}, auth=False)
    check("[rec] consent recorded", st["recording"]["consentGiven"] is True)
    seg = call("POST", f"{cand}/recordings", {"stream": "camera", "mimeType": "video/webm;codecs=vp8,opus"}, auth=False)
    seg_id = seg["segmentId"]
    chunk = os.urandom(1024)
    codes = []
    for seq, body in ((0, chunk), (0, chunk), (2, chunk), (1, chunk)):
        status, _, _ = call_raw("PUT", f"{cand}/recordings/{seg_id}/chunks/{seq}", body,
                                {"content-type": "application/octet-stream"})
        codes.append(status)
    check("[rec] chunk ordering (ok, dup no-op, gap 409, ok)", codes == [200, 200, 409, 200], str(codes))
    call("POST", f"/api/sessions/{sid}/start", expect=201)
    first = section["questionKeys"][0]
    call("POST", f"/api/sessions/{sid}/present", {"questionKey": first}, expect=201)
    st = call("GET", f"{cand}/state", auth=False)
    check("[rec] section countdown set", bool(st["sectionEndsAt"]) and set(st["answer"] or {}) == {"text", "savedAt"}, str(st.get("answer")))
    call("PUT", f"{cand}/answer", {"position": 1, "text": "mean 0.042, sharpe ~13 but meaningless"}, auth=False)
    status, _, _ = call_raw("PUT", f"{cand}/answer", json.dumps({"position": 3, "text": "x"}).encode(),
                            {"content-type": "application/json"})
    check("[rec] answer to an unpresented question refused (409)", status == 409, str(status))
    call("POST", f"{cand}/events", {"events": [
        {"type": "paste", "clientAt": "2026-09-27T14:00:00Z", "detail": "12 chars"},
        {"type": "tab_hidden", "clientAt": "2026-09-27T14:00:01Z"}]}, auth=False, expect=204)
    before = call("GET", f"/api/sessions/{sid}")
    after = call("POST", f"/api/sessions/{sid}/extend", {"minutes": 5}, expect=201)
    s = after
    resp = {r["questionKey"]: r for r in s["responses"]}
    check("[rec] interviewer sees the typed answer", resp.get(first, {}).get("candidateAnswer", "").startswith("mean 0.042"))
    check("[rec] segment stored (2 chunks, 2048 bytes)",
          [(g["chunks"], g["bytes"]) for g in s["recording"]["segments"]] == [(2, 2048)], json.dumps(s["recording"]["segments"]))
    evs = [(e["type"], e["questionKey"]) for e in s["events"] if e["type"] in ("paste", "tab_hidden")]
    check("[rec] events stored with server-derived question", evs == [("paste", first), ("tab_hidden", first)], str(evs))
    check("[rec] extension moves the deadline", after["extensionMinutes"] == 5 and after["sectionEndsAt"] > before["sectionEndsAt"])
    status, body, hdrs = call_raw("GET", f"/api/sessions/{sid}/recordings/{seg_id}", None, {"range": "bytes=0-99"}, auth=True)
    check("[rec] protected playback supports Range (206, 100 bytes)", status == 206 and body == chunk[:100], str(status))
    status, _, _ = call_raw("GET", f"/api/sessions/{sid}/recordings/{seg_id}", None, {"range": "bytes=0-99"}, auth=False)
    check("[rec] playback refused without identity", status in (401, 403), str(status))
    status, _, _ = call_raw("GET", f"{cand}/recordings/{seg_id}", None)
    check("[rec] no media on the public candidate path", status in (404, 405), str(status))
    call("POST", f"{cand}/recordings/{seg_id}/stop", {}, auth=False, expect=204)
    call("POST", f"/api/sessions/{sid}/end", expect=201)


MARKET_KEYS = {"gameNumber", "prompt", "unit", "reveals", "status", "quote", "trades", "position", "settlement"}


def mcq_flow(cid, section, kit):
    """v1.2: self-paced multiple choice with negative marking; the answer key never reaches the candidate."""
    sk = section["key"]
    qs = {q["key"]: q for q in kit["questions"] if q["section"] == sk}
    sess = call("POST", "/api/sessions", {"candidateId": cid, "section": sk, "recordingRequired": False}, expect=201)
    sid, token = sess["id"], sess["candidateUrl"].rsplit("/c/", 1)[1]
    cand = f"/api/candidate/{token}"
    status, _, _ = call_raw("POST", f"/api/sessions/{sid}/start", b"", auth=True)
    check(f"[{sk}] interviewer can't drive a self-paced section (409)", status == 409, str(status))
    call("POST", f"{cand}/start", {}, auth=False)
    order = call("GET", f"/api/sessions/{sid}")["questionOrder"] or section["questionKeys"]
    n = len(order)
    marking = section["autoScoring"]
    expected = 0.0
    for pos in range(1, n + 1):
        st = call("POST", f"{cand}/navigate", {"position": pos}, auth=False)
        q = qs[order[pos - 1]]
        blob = json.dumps(st)
        leaks = [f for f in ("correctChoice", "modelAnswer") if f in blob]
        leaks += [t for t in (q["title"], q.get("modelAnswer") or "") if t and len(t) >= 8 and t in blob]
        shown = st["question"]["choices"]
        ok = set(st) == STATE_KEYS and set(st["question"]) == QUESTION_KEYS and sorted(shown) == sorted(q["choices"]) and not leaks
        check(f"[{sk}] pos {pos} shows only its options, no key", ok, f"leaks={leaks}")
        correct_text = q["choices"][q["correctChoice"]]
        if pos <= 3:
            pick, expected = shown.index(correct_text), expected + marking["correct"]
        elif pos == 4:
            pick, expected = next(i for i, c in enumerate(shown) if c != correct_text), expected + marking["wrong"]
        else:
            pick, expected = None, expected + marking["blank"]
        if pick is not None:
            call("PUT", f"{cand}/choice", {"position": pos, "choice": pick}, auth=False)
    st = call("POST", f"{cand}/submit", {}, auth=False)
    check(f"[{sk}] submitted → ended", st["phase"] == "ended")
    v = call("GET", f"/api/sessions/{sid}")["verdict"]
    check(f"[{sk}] negative marking total = {expected}", abs(v["total"] - expected) < 1e-9 and v["complete"], json.dumps(v))


def market_flow(cid, section, kit):
    """v1.2: make-a-market — quote, trade, reveal, settle; no true value before settlement."""
    sk = section["key"]
    templates = [q for q in kit["questions"] if q["section"] == sk and q.get("market")]
    dice = next(q for q in templates if q["market"]["kind"] == "dice")
    sess = call("POST", "/api/sessions", {"candidateId": cid, "section": sk, "recordingRequired": False}, expect=201)
    sid, token = sess["id"], sess["candidateUrl"].rsplit("/c/", 1)[1]
    cand = f"/api/candidate/{token}"
    call("POST", f"/api/sessions/{sid}/start", expect=201)
    s = call("POST", f"/api/sessions/{sid}/market/games", {"questionKey": dice["key"]}, expect=201)
    game = s["market"]["games"][-1]
    st = call("GET", f"{cand}/state", auth=False)
    m = st["market"] or {}
    blob = json.dumps(st)
    check(f"[{sk}] candidate sees the market, not the truth", set(m) == MARKET_KEYS and m["settlement"] is None
          and "trueValue" not in blob and "fairValue" not in blob, json.dumps(m)[:200])
    call("PUT", f"{cand}/quote", {"bid": 9, "ask": 12, "size": 1}, auth=False)
    status, _, _ = call_raw("PUT", f"{cand}/quote", json.dumps({"bid": 12, "ask": 9, "size": 1}).encode(),
                            {"content-type": "application/json"})
    check(f"[{sk}] crossed quote refused (400)", status == 400, str(status))
    s = call("POST", f"/api/sessions/{sid}/market/games/{game['id']}/trade", {"side": "buy"}, expect=201)
    g = s["market"]["games"][-1]
    check(f"[{sk}] interviewer lifted the ask: candidate short 1 @ 12", g["position"] == -1 and g["trades"][0]["price"] == 12)
    call("POST", f"/api/sessions/{sid}/market/games/{game['id']}/reveal", expect=201)
    s = call("POST", f"/api/sessions/{sid}/market/games/{game['id']}/settle", expect=201)
    g = s["market"]["games"][-1]
    check(f"[{sk}] settled P&L = 12 − true value", g["status"] == "settled" and abs(g["metrics"]["pnl"] - (12 - g["trueValue"])) < 1e-9,
          json.dumps(g.get("metrics")))
    st = call("GET", f"{cand}/state", auth=False)
    check(f"[{sk}] candidate sees settlement after settle", (st["market"] or {}).get("settlement", {}) and
          st["market"]["settlement"]["value"] == g["trueValue"])


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

    live_rubric = [s for s in kit["sections"] if s["candidateView"] and s["scoring"] == "rubric" and not s.get("selfPaced")]
    for section in live_rubric:
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
            leaked = [s[:40] for s in secrets if s in blob] + (["G-20"] if re.search(r"G-?20", blob, re.I) else [])
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

    if live_rubric:
        recorded_flow(cid, live_rubric[0])
    for section in kit["sections"]:
        if section["scoring"] == "auto" and section.get("selfPaced"):
            mcq_flow(cid, section, kit)
        if section["scoring"] == "market":
            market_flow(cid, section, kit)

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
