# talent-os — working notes

Hiring pipeline and live interview engine for G-20 Group. Role-agnostic by design: a job has an
interview plan, each stage runs a versioned interview kit, and scorecards roll up into a human
decision. The first kit is the Quant Trader kit (Basis Trading Desk).

## Ground rules

- **The candidate view is an allowlist.** `CandidateState` in `api/src/contracts/api.ts` is the only
  data an unauthenticated request can ever receive. Beyond the presented question it may carry only
  the candidate's own typed answer and their recording/consent status. Never add a question title,
  key, model answer, rubric, trap note, score, interviewer note, flag, other questions or other
  candidates. A title alone can give
  an answer away. Tests enforce this; keep them.
- **Recordings are the most sensitive data we hold.** A candidate's camera, microphone and screen
  are recorded only after they accept the consent notice. Recordings are stored in the `recordings`
  volume, served only on protected `/api/sessions/:id/recordings/*`, never under `/api/candidate/`,
  and deleted 90 days after the hiring decision. Integrity events record counts, never content —
  a paste is logged as "412 chars", not as what was pasted.
- **Candidates see BTNET, never G-20.** The parent group does not disclose that it is hiring.
  Candidate-facing text takes its name from `CANDIDATE_BRAND`, never from the internal org name.
  This covers the page header, the consent notice and anything future such as emails or the careers
  site. `scripts/smoke.py` fails if "G-20" reaches the candidate payload or the public bundle.
- **Real kits never enter git.** Kits with answers live in `private/` (gitignored) and in the
  database. The org's default repository permission is `read`, so every member — including a
  future hire — can read this repo. Only synthetic fixtures (`kit/fixtures/`) are committed.
- **Humans decide.** Thresholds produce a suggested verdict. Nothing advances, rejects or emails a
  candidate automatically.
- **Multi-org from day one.** Every tenant-owned row carries `orgId`; every query is scoped to the
  caller's org. The design test: "would this still work for a second organisation?"
- **Role-agnostic.** No Quant-specific logic in code. Sections, dimensions, bands, domains and
  recommendation options come from the kit. The design test: "would this work for an ops hire?"
- **Sessions pin the kit version they ran**, so scores stay comparable and auditable.
- **The app never executes candidate code.**
- **No PII in logs** — log ids, not names or emails.
- **The HTTP contract is frozen** in `api/src/contracts/`. It is shared with `ui/` through the
  `@contracts` alias. Change it deliberately, in its own PR.

## Layout

| Path | What |
|---|---|
| `api/` | NestJS + Prisma + Postgres. Schema of record, REST API, candidate-view endpoint, exports, kit seeder. |
| `ui/` | React + Vite + TS. Interviewer console, candidate view (`/c/:token`), comparison, printable scorecard. |
| `kit/` | `parse-kit.ts`: Markdown interview kit → `KitSeed` JSON. Synthetic fixtures only. |
| `private/` | Gitignored. Real kits (`private/kits/*.md`) and their seed files (`*.seed.json`). |
| `docs/` | Product scope, scoping decisions, deployment. |

## Identity and exposure

Cloudflare Access protects `hiring.basistrading.net`. The API reads the interviewer's email from
`Cf-Access-Authenticated-User-Email` (with optional JWT verification when `ACCESS_AUD` is set).
Only `/c/*`, `/api/candidate/*` and `/assets/*` bypass Access — so nothing sensitive may ever be
served under those prefixes. `DEV_USER_EMAIL` is a local-development fallback only.

## Git

- Branch + PR for every change; never push to `main`. The org ruleset requires PRs, and an admin
  push "succeeds" by silently bypassing it.
- The Studio has no global git identity:
  `git -c user.name="Hitesh Bhatia" -c user.email="hiteshbhatia3559@gmail.com" commit …`

## Common commands

```bash
docker compose up -d postgres                          # dev database on 127.0.0.1:5442
node kit/parse-kit.ts private/kits/quant-trader-interview-kit.md private/kits/quant-trader.seed.json
cd api && npm ci && npx prisma generate && npx prisma migrate dev && npm run start:dev   # :4310
cd ui && npm ci && npm run dev                         # :5173, proxies /api to :4310
docker compose up -d --build                           # whole stack, http://localhost:8170
docker compose --profile tunnel up -d                  # publish via the talent-os tunnel
```
