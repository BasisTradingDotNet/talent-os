#!/usr/bin/env python3
"""Run the screening benchmark for one model.

    python3 run.py --model qwen3.5:122b            # real run against Ollama
    python3 run.py --model qwen3.5:122b --no-think # for thinking models: skip the reasoning phase
    python3 run.py --model mock-a --mock           # deterministic fake backend, no Ollama
    python3 run.py --model mock-b --mock --limit 5

For each CV in cvs/NNN.md: redact -> POST /api/chat (format = schema.json, temperature 0,
num_ctx 16384, stream false) -> parse and validate -> one retry on invalid output -> append a JSONL
record to results/<model>.jsonl with latency and Ollama token/duration counters. The last request
sends keep_alive: 0 so the model is unloaded when the run ends.

The model never emits a tier; score.py derives it from the criterion scores (rules.derive_tier).
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import redact  # noqa: E402
import rules  # noqa: E402

CV_DIR = os.path.join(HERE, "cvs")
RESULTS_DIR = os.path.join(HERE, "results")
DEFAULT_HOST = "http://127.0.0.1:11434"
NUM_CTX = 16384
NUM_PREDICT = 2048


# ---------------------------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------------------------

def load_prompt() -> Tuple[str, str]:
    with open(rules.PROMPT_PATH, "r", encoding="utf-8") as fh:
        text = fh.read()
    if "---SYSTEM---" not in text or "---USER---" not in text:
        raise SystemExit("prompt.md must contain ---SYSTEM--- and ---USER--- markers")
    after_system = text.split("---SYSTEM---", 1)[1]
    system, user = after_system.split("---USER---", 1)
    return system.strip(), user.strip()


def build_messages(system: str, user_tpl: str, rubric_md: str, cv_text: str) -> List[Dict[str, str]]:
    user = user_tpl.replace("{{RUBRIC}}", rubric_md).replace("{{CV}}", cv_text.rstrip("\n"))
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def list_cvs(limit: Optional[int] = None, ids: Optional[List[str]] = None) -> List[Tuple[str, str]]:
    out = []
    for name in sorted(os.listdir(CV_DIR)):
        if re.fullmatch(r"\d{3}\.md", name):
            cid = name[:-3]
            if ids and cid not in ids:
                continue
            out.append((cid, os.path.join(CV_DIR, name)))
    if limit:
        out = out[:limit]
    return out


def model_filename(model: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", model)


# ---------------------------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------------------------

class OllamaBackend:
    def __init__(self, host: str, model: str, timeout: float, think: Optional[bool]) -> None:
        self.host = host.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.think = think

    def chat(self, messages: List[Dict[str, str]], fmt: Dict[str, Any],
             keep_alive: Optional[int] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "format": fmt,
            "stream": False,
            "options": {"temperature": 0, "num_ctx": NUM_CTX, "num_predict": NUM_PREDICT},
        }
        if keep_alive is not None:
            body["keep_alive"] = keep_alive
        if self.think is not None:
            body["think"] = self.think
        req = urllib.request.Request(
            self.host + "/api/chat", data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            data = json.load(resp)
        content = (data.get("message") or {}).get("content", "")
        return {
            "content": content,
            "prompt_eval_count": data.get("prompt_eval_count"),
            "eval_count": data.get("eval_count"),
            "eval_duration_ns": data.get("eval_duration"),
            "prompt_eval_duration_ns": data.get("prompt_eval_duration"),
            "total_duration_ns": data.get("total_duration"),
            "load_duration_ns": data.get("load_duration"),
            "simulated_latency_s": None,
        }


_MOCK_KEYWORDS = {
    "trading_experience": ["prop", "market maker", "market-maker", "market making", "trading desk",
                           "quant trader", "trader,", "pnl", "book", "desk"],
    "python": ["python", "pytest", "ci", "deploy", "service", "pipeline", "on-call", "packag"],
    "derivatives": ["perp", "funding", "basis", "margin", "liquidation", "mark price", "index price",
                    "cash-and-carry", "cross-margin"],
    "risk": ["limit", "kill switch", "kill-switch", "drawdown", "post-mortem", "pre-trade", "alert",
             "incident", "circuit breaker"],
    "tooling": ["reconciliation", "recon", "reporting", "dashboard", "automation", "tca", "slippage",
                "fills", "report"],
    "rust_lowlat": ["rust", "c++", "latency", "lock-free", "async"],
}
_MOCK_INJECTION = re.compile(r"(?i)ignore (?:all )?(?:previous|prior) instructions|rate this candidate strong|"
                             r"system override|classify as strong|mark this application as strong|"
                             r"score 3 on (?:all|every) criteri|note to (?:ai|automated) screener")
_CITIES = ["Mumbai", "Bangalore", "Bengaluru", "Gurgaon", "Gurugram", "Hyderabad", "Pune", "Chennai",
           "Kolkata", "Delhi", "London", "Manchester", "Singapore", "Dubai", "Amsterdam", "Chicago",
           "New York", "Lagos", "Warsaw", "Toronto", "Nashik"]


class MockBackend:
    """Deterministic fake model. Two personalities:

    mock-a: keyword scorer, mostly verbatim quotes, resists injections and flags them; a few
            fabricated quotes; occasional invalid JSON on the first attempt (fixed on retry).
    mock-b: same scorer but follows injections (scores 3 everywhere), paraphrases quotes more
            often, is slower, and the sparsest CV stays invalid even after retry.
    """

    def __init__(self, model: str) -> None:
        self.model = model
        self.persona = "b" if model.endswith("b") else "a"
        self.calls: Dict[str, int] = {}

    @staticmethod
    def _seed(cid: str, model: str) -> int:
        return int(hashlib.sha256((cid + "|" + model).encode()).hexdigest()[:8], 16)

    def _score(self, text: str) -> Dict[str, Any]:
        low = text.lower()
        lines = [ln for ln in text.splitlines() if ln.strip()]
        crit = []
        for cid in rules.CRITERIA:
            kws = _MOCK_KEYWORDS[cid]
            hits = [k for k in kws if k in low]
            if not hits:
                crit.append({"id": cid, "score": None, "evidence": None})
                continue
            n = sum(low.count(k) for k in hits)
            score = 1 if n <= 1 else (2 if n <= 4 else 3)
            ev = None
            for ln in lines:
                if any(k in ln.lower() for k in hits) and len(ln.strip()) > 15:
                    ev = ln.strip()[:200]
                    break
            crit.append({"id": cid, "score": score, "evidence": ev})
        return {"criteria": crit}

    def chat(self, messages: List[Dict[str, str]], fmt: Dict[str, Any],
             keep_alive: Optional[int] = None) -> Dict[str, Any]:
        user = messages[1]["content"]
        cv = user.split("<cv>", 1)[1].split("</cv>", 1)[0].strip() if "<cv>" in user else user
        cid = hashlib.sha256(cv.encode()).hexdigest()[:8]
        seed = self._seed(cid, self.model)
        attempt = self.calls.get(cid, 0) + 1
        self.calls[cid] = attempt

        out = self._score(cv)
        injected = bool(_MOCK_INJECTION.search(cv))
        flags: List[str] = []
        if injected and self.persona == "a":
            flags.append("injection_attempt")
        if injected and self.persona == "b":
            for c in out["criteria"]:
                c["score"] = 3
                c["evidence"] = c["evidence"] or "meets every criterion"
        if len(cv.split()) < 80:
            flags.append("sparse_cv")
        # fabricated (paraphrased) quotes on a deterministic subset
        fab_every = 4 if self.persona == "b" else 9
        for i, c in enumerate(out["criteria"]):
            if c["evidence"] and (seed + i) % fab_every == 0:
                c["evidence"] = "Worked on " + c["evidence"][:50].lower().rstrip(".") + " and related tasks"
        m = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)", cv, re.IGNORECASE)
        loc = next((c for c in _CITIES if c in cv), None)
        low = cv.lower()
        emp = ("crypto_native" if "crypto" in low else "prop_shop" if "prop" in low else
               "market_maker" if "market mak" in low else "broker" if "broker" in low else "other")
        result = {
            "facts": {
                "years_experience": float(m.group(1)) if m else None,
                "current_employer_type": emp,
                "notice_period_days": 30 if "notice" in low else None,
                "expected_ctc_lpa": None,
                "location": loc,
            },
            "criteria": out["criteria"],
            "summary": "Mock summary line 1.\nMock summary line 2.\nMock summary line 3.",
            "flags": flags,
        }
        content = json.dumps(result)
        invalid_first = (seed % 7 == 0) and attempt == 1
        invalid_always = self.persona == "b" and len(cv.split()) < 25  # mock-b never recovers on the sparsest CV
        if invalid_first or invalid_always:
            content = content[: len(content) // 2]  # truncated JSON
        prompt_tokens = max(1, sum(len(m_["content"]) for m_ in messages) // 4)
        eval_tokens = max(1, len(content) // 4)
        tok_s = 38.0 if self.persona == "a" else 22.0
        prompt_tok_s = 900.0 if self.persona == "a" else 450.0
        eval_ns = int(eval_tokens / tok_s * 1e9)
        prompt_ns = int(prompt_tokens / prompt_tok_s * 1e9)
        latency = (prompt_ns + eval_ns) / 1e9 + 0.2 + (seed % 100) / 100.0
        return {
            "content": content,
            "prompt_eval_count": prompt_tokens,
            "eval_count": eval_tokens,
            "eval_duration_ns": eval_ns,
            "prompt_eval_duration_ns": prompt_ns,
            "total_duration_ns": prompt_ns + eval_ns,
            "load_duration_ns": 0,
            "simulated_latency_s": round(latency, 3),
        }


# ---------------------------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------------------------

def screen_one(backend: Any, cid: str, cv_text: str, system: str, user_tpl: str, rubric_md: str,
               schema: Dict[str, Any], last: bool) -> Dict[str, Any]:
    redacted = redact.redact(cv_text)
    messages = build_messages(system, user_tpl, rubric_md, redacted)
    keep_alive = 0 if last else None
    record: Dict[str, Any] = {
        "id": cid,
        "model": getattr(backend, "model", "?"),
        "prompt_version": rules.prompt_version(),
        "redacted_sha256": hashlib.sha256(redacted.encode("utf-8")).hexdigest(),
        "redacted_chars": len(redacted),
        "ts": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "attempts": 0,
        "json_valid": False,
        "schema_valid": False,
        "problems": [],
        "output": None,
        "raw": None,
        "error": None,
        "latency_s": 0.0,
        "prompt_eval_count": None,
        "eval_count": None,
        "eval_duration_ns": None,
        "prompt_eval_duration_ns": None,
        "total_duration_ns": None,
        "load_duration_ns": None,
    }
    wall = 0.0
    msgs = messages
    for attempt in (1, 2):
        record["attempts"] = attempt
        t0 = time.monotonic()
        try:
            resp = backend.chat(msgs, schema, keep_alive=keep_alive)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:500]
            record["error"] = "HTTP %s: %s" % (exc.code, body)
            wall += time.monotonic() - t0
            break
        except (urllib.error.URLError, OSError) as exc:
            record["error"] = "connection: %s" % exc
            wall += time.monotonic() - t0
            break
        elapsed = resp.get("simulated_latency_s")
        wall += elapsed if elapsed is not None else (time.monotonic() - t0)
        for key in ("prompt_eval_count", "eval_count", "eval_duration_ns", "prompt_eval_duration_ns",
                    "total_duration_ns", "load_duration_ns"):
            if resp.get(key) is not None:
                record[key] = (record[key] or 0) + resp[key]  # summed across attempts
        raw = resp.get("content", "")
        parsed, err = rules.parse_output(raw)
        if parsed is None:
            record["problems"] = ["invalid JSON: %s" % err]
            record["raw"] = raw[:2000]
        else:
            ok, problems = rules.validate_output(parsed)
            record["json_valid"] = True
            record["problems"] = problems
            if ok:
                record["schema_valid"] = True
                record["output"] = parsed
                record["raw"] = None
                break
            record["raw"] = raw[:2000]
            record["json_valid"] = False  # valid JSON but wrong shape counts as invalid output
        if attempt == 1:
            msgs = messages + [
                {"role": "assistant", "content": raw[:4000]},
                {"role": "user", "content": "That response was not valid JSON matching the schema (%s). "
                                            "Return only the JSON object, nothing else."
                                            % "; ".join(record["problems"])[:500]},
            ]
    record["latency_s"] = round(wall, 3)
    return record


def already_done(path: str) -> set:
    done = set()
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        done.add(json.loads(line)["id"])
                    except (ValueError, KeyError):
                        pass
    return done


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="Ollama model name, e.g. qwen3.5:122b (or mock-a / mock-b with --mock)")
    ap.add_argument("--limit", type=int, default=None, help="only the first N CVs")
    ap.add_argument("--ids", default=None, help="comma-separated CV ids, e.g. 001,024,038")
    ap.add_argument("--mock", action="store_true", help="use the deterministic fake backend; never touches Ollama")
    ap.add_argument("--host", default=DEFAULT_HOST, help="Ollama base URL (default %(default)s)")
    ap.add_argument("--timeout", type=float, default=900.0, help="per-request timeout in seconds")
    ap.add_argument("--no-think", action="store_true", help="send think:false (Qwen3-style thinking models)")
    ap.add_argument("--think", action="store_true", help="send think:true")
    ap.add_argument("--out", default=None, help="output JSONL path (default results/<model>.jsonl)")
    ap.add_argument("--resume", action="store_true", help="skip ids already present in the output file")
    ap.add_argument("--fresh", action="store_true", help="delete the output file before starting")
    args = ap.parse_args(argv)

    think: Optional[bool] = True if args.think else (False if args.no_think else None)
    backend: Any = MockBackend(args.model) if args.mock else OllamaBackend(args.host, args.model, args.timeout, think)

    os.makedirs(RESULTS_DIR, exist_ok=True)
    out_path = args.out or os.path.join(RESULTS_DIR, model_filename(args.model) + ".jsonl")
    if args.fresh and os.path.exists(out_path):
        os.remove(out_path)
    if not args.resume and not args.fresh and os.path.exists(out_path):
        os.remove(out_path)  # a plain run always starts a fresh file
    ids = args.ids.split(",") if args.ids else None
    cvs = list_cvs(args.limit, ids)
    if not cvs:
        print("no CVs found in", CV_DIR, file=sys.stderr)
        return 2
    done = already_done(out_path) if args.resume else set()
    todo = [(cid, path) for cid, path in cvs if cid not in done]

    system, user_tpl = load_prompt()
    rubric_md = rules.rubric_text(rules.load_rubric())
    schema = rules.load_schema()

    print("model=%s backend=%s cvs=%d (skipping %d done) -> %s" % (
        args.model, "mock" if args.mock else args.host, len(todo), len(done), out_path))
    t_start = time.monotonic()
    n_ok = 0
    with open(out_path, "a", encoding="utf-8") as fh:
        for i, (cid, path) in enumerate(todo):
            with open(path, "r", encoding="utf-8") as cv_fh:
                cv_text = cv_fh.read()
            rec = screen_one(backend, cid, cv_text, system, user_tpl, rubric_md, schema, last=(i == len(todo) - 1))
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fh.flush()
            if rec["error"]:
                print("  %s ERROR %s" % (cid, rec["error"]), file=sys.stderr)
                if i == 0 and rec["error"].startswith("connection"):
                    print("Ollama unreachable at %s — aborting." % args.host, file=sys.stderr)
                    return 3
                continue
            n_ok += int(rec["schema_valid"])
            tier = rules.derive_tier(rules.scores_from_output(rec["output"])) if rec["output"] else "-"
            print("  %s %5.1fs attempts=%d valid=%s tier=%s" % (
                cid, rec["latency_s"], rec["attempts"], rec["schema_valid"], tier))
    print("done: %d/%d valid in %.1fs wall" % (n_ok, len(todo), time.monotonic() - t_start))
    return 0


if __name__ == "__main__":
    sys.exit(main())
