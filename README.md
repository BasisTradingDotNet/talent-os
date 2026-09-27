# talent-os

Hiring pipeline and live interview engine for **G-20 Group**.

Every job gets an interview plan; each stage runs a versioned **interview kit** (questions,
datasets, code, timers, hidden model answers and rubrics); interviewers score in a live console
while the candidate follows on a token link that shows only what they need; scorecards roll up into
a decision a human makes. The engine is role-agnostic and multi-org-ready. The first kit is the
Quant Trader kit for the Basis Trading Desk.

**Status:** v0 — the live interview console for all four stages of the Quant Trader kit.
The wider pipeline (jobs, careers site, scheduling, email, offers, analytics) is scoped in
[docs/PRODUCT.md](docs/PRODUCT.md); the decisions behind it are in [docs/SCOPING.md](docs/SCOPING.md).

## Layout

| Path | What |
|---|---|
| `api/` | NestJS + Prisma + Postgres — schema of record, REST API, candidate view, exports, kit seeder |
| `ui/` | React + Vite + TypeScript — interviewer console, candidate view, comparison, scorecards |
| `kit/` | Markdown kit parser and synthetic fixtures |
| `private/` | **Gitignored.** Real kits and their seed files — they contain model answers |

## Quick start

```bash
cp .env.example .env
node kit/parse-kit.ts private/kits/quant-trader-interview-kit.md private/kits/quant-trader.seed.json
docker compose up -d --build              # http://localhost:8170
docker compose --profile tunnel up -d     # publish at https://hiring.basistrading.net
```

Working notes and ground rules for contributors (human or agent) are in [CLAUDE.md](CLAUDE.md).
