# Scoping decisions — 50 questions

**Date:** 2026-09-27 · **Owner:** Hitesh Bhatia

Hitesh answered Q1–Q4 directly and delegated Q5–Q50 ("use your recommendations"). Later the same day
he set the target, *"a system dedicated to my company, designed to screen 500 candidates a day, with an
AI summary and classification from a locally run model"*, and answered four follow-ups (Q51–Q54,
section 14). Rows those answers changed are marked **revised**. ★ marks the
option that was recommended when the question was posed. Where Hitesh's answers to Q3 and Q4 changed
what the right answer was, the entry says **adjusted for Q3/Q4** and names the original ★.

To override a decision, edit the row in a PR. [PRODUCT.md](PRODUCT.md) turns these decisions into
scope and phasing.

Two answers shaped everything else:

- **Q3: "in about two hours".** The first release (v0) became a same-day build of the kit's Section 0
  live console for all four stages. The rest of the pipeline is phased behind it.
- **Q4: "keep commodity pieces outside the app".** There are no e-signature, background-check, video,
  job-board or messaging-vendor integrations. The app records what happened elsewhere, and later
  answers were adjusted to match.

## 1 · Vision and boundaries — answered by Hitesh

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 1 | Which organisations will hire through this app? | **G-20 now, multi-org-ready** ★ | G-20 + other ventures in v1 · G-20 only, single org · sell as SaaS | `orgId` on every tenant row; every query scoped. Other ventures can be added as orgs later without a migration. |
| 2 | What must v1 do before anything else? | **Pipeline core + live console** ★ | Full ATS parity first · console only | v0 is the console. v1 adds jobs, applications and a stage board on the same data model. |
| 3 | When must v1 run a real Quant Trader interview? | **In about two hours** (13:55 BST, 27 Sep 2026) | 2–3 weeks ★ · 4–6 weeks · no hard date | v0 was cut to the Section 0 console and built the same day with parallel agents. |
| 4 | Commodity pieces (e-sign, background checks, video, job-board posting): build or integrate? | **Keep outside the app** | Integrate via APIs ★ · build in-house | Do them by hand and record the outcome in the app. No vendor integrations. |

## 2 · People and access — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 5 | How is access to candidates and jobs controlled? | **Roles + per-job hiring teams** ★ | Simple roles, open data · custom permission sets | Interviewers see only the candidates they meet. Comp is visible only to the hiring manager, leadership and admins. |
| 6 | How do internal users sign in? | **Microsoft 365 (Entra ID) SSO** ★, magic links for outside interviewers | Email magic link + passkeys · Cloudflare Access only | v0 is gated by Cloudflare Access (house pattern). App-native SSO arrives with roles in v1. `basistrading.net` mail is on M365. |
| 7 | Do candidates get a self-service portal? | **Passwordless portal per application** ★ | Email + one-off links · full accounts | v0 has only the live-test token link. The portal (status, uploads, take-home) reuses the same token pattern. |
| 8 | Which bias controls are built in? | **Blind scorecards** ★, **anonymised take-home marking**, **rubric-anchored ratings**. Anonymised CV screening is a per-job toggle, off by default. | — (multi-select) | Panellists can't see each other's feedback until they submit. Take-homes are marked by code number. Every rating is tied to a written anchor. |

## 3 · Jobs and pipeline — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 9 | How is each job's interview plan defined? | **Templates, customised per job** ★ | One global pipeline · built fresh per job | The Quant kit's four stages become the first template. New jobs clone a template. |
| 10 | What happens when a candidate passes or misses a threshold? | **Suggest; a human moves them** ★ — **revised:** except the knockout rules in Q53 | Auto-advance passes · fully automatic | Verdict chips only. Nothing is rejected automatically (a CLAUDE.md ground rule). |
| 11 | Which steps need sign-off beyond the hiring manager? | **Offer terms** ★ and **hire / no-hire decision** ★ | Opening a job · moving to final round | Leadership approval records on decisions and offers. |
| 12 | What happens to candidates you don't hire? | **Rejection reasons + opt-in talent pool** ★ | Reasons only · full CRM with nurture emails | A structured reasons taxonomy feeds analytics. Near-misses are kept only with consent (see Q45). |

## 4 · Sourcing and intake — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 13 | Public careers site? | **Hosted on your domain** ★ | Embedded in the main website · none | Server-rendered job pages with Google for Jobs markup, an application form and per-org branding. |
| 14 | How do jobs reach LinkedIn, Naukri, eFinancialCareers and crypto boards? | **Google for Jobs + tracked links** ★ (fits Q4) | Paid multiposting · direct board integrations | You post by hand with a per-board tracked link, so every applicant's source is attributed. |
| 15 | Intake channels besides direct applications? | **Revised by Q54:** the careers site and the hiring@ mailbox are the main channels. Bulk import ★ stays for backfills; referrals and prospects come later. No agency portal. | — (multi-select) | CSV import (e.g. the current Quant search), referral links, prospects added by hand. |
| 16 | What does the app do with CVs? | **Revised by Q52:** a local model scores each application against the job's screening rubric, suggests a tier and writes a summary; a human confirms | Parse only · AI ranking · store PDF only | Tiering is now in scope, by Hitesh's call. See section 14. |

## 5 · Interview kits — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 17 | Where does confidential kit content live? | **App only; repo holds synthetic samples** ★ | Markdown in the repo · app + restricted kits repo | **Already applied:** the real kit is in gitignored `private/` and the database. The org's default repo permission is `read`, so every member (including future hires) could read it in git. |
| 18 | One shared question bank that kits reference? | **Shared, versioned bank** ★ | Each kit owns copies | v0 stores questions per kit version. v1 moves to bank questions referenced by kits. Sessions stay pinned to the version they ran. |
| 19 | Per-candidate variants of numeric questions? | **Yes, in phase 2** ★ (fixed questions in v1) | In v1 · never | Numeric questions become parameterised templates whose answers are computed and verified in code. A leaked answer sheet stops working. |
| 20 | Should the app draft kits for new roles? | **AI drafts, a human publishes** ★ | Single-question suggestions · no AI | From a job description, AI drafts stages, questions, rubrics and answers. Numeric answers are verified in code before review. |

## 6 · Live console — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 21 | Where do candidates do sheet and code work? | **External tools, as in the kit** ★ | Built-in grid + code pad · sandboxed execution | As built: Sheets/Excel on screen share plus copy-as-TSV. The app never executes candidate code. |
| 22 | Can several interviewers run one session? | **Yes: one driver, private scoring** ★ | One console; others file scorecards later | Needed for Stage 4 with Jonathan Mathai and Dr. Nag. |
| 23 | Record and transcribe interviews? | **Later, consent-based: upload the Teams transcript and AI drafts per-question notes** — adjusted for Q4 (★ assumed a meeting bot or in-app video) | In v1 · never | No bot and no stored video. The transcript is the only artefact. |
| 24 | Live-test integrity? | **Soft signals** ★ | Full proctoring · none | The candidate view logs tab switches, focus loss and pastes for the interviewer. |

## 7 · Scorecards and decisions — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 25 | How is the hire / no-hire decision made? | **Debrief page + recorded decision with rationale** ★ | A stage move · committee vote | All scorecards side by side with disagreements highlighted. The decision and its reasons are stored. |
| 26 | A single composite score? | **No — stage results side by side** ★ | Weighted composite · both | Keeps the quant/python gap visible, which the kit treats as a conversation rather than a rejection. |
| 27 | What do rejected candidates hear? | **Templated reason + optional personal note** ★ | Generic rejection · detailed feedback | Consistent and humane, with low legal exposure. |

## 8 · Take-homes and assessments — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 28 | How are take-homes delivered and collected? | **Portal with a timed window** ★ | Email out/back · third-party platform | The clock starts on download. Uploads close at the deadline, and late work is flagged, not lost. |
| 29 | Unique dataset per candidate? | **Seeded per candidate** ★ | Same for everyone | Each dataset is generated with the planted features and its own answer key, so one leak doesn't burn the case. |
| 30 | Candidate use of AI on take-homes? | **Allowed, declared, defended live** ★ | Prohibited · unrestricted | A declaration field on submission, plus a "walk me through it" slot. |
| 31 | How is marking assisted? | **Results CSV vs answer key** ★ | Human only · sandboxed code execution | The app diffs the candidate's results file against the key. It never runs candidate code. |

## 9 · Scheduling — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 32 | Calendars? | **ICS invites; the app records the slot; scheduling happens in Outlook** — adjusted for Q4 (★ was M365 two-way sync) | M365 two-way sync · out of scope | The M365 calendar is the first integration to revisit. |
| 33 | Candidate self-booking? | **Not in v1** — adjusted for Q4 (★ was live free/busy booking) | Coordinator proposes slots | Needs calendar integration. Revisit alongside Q32. |
| 34 | Track who is qualified to run each kit? | **Later, with shadowing** ★ | In v1 · never | For when the desk grows: new interviewers shadow first. |

## 10 · Communication — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 35 | How does the app send and receive email? | **Shared `hiring@basistrading.net` M365 mailbox; the app sends via SMTP and logs it; replies are handled in Outlook** — adjusted for Q4 (★ was a transactional provider with threaded replies) | Each user's own mailbox · no sending | No new vendor. |
| 36 | Do stage changes trigger emails? | **Drafted automatically, a human confirms** ★ | Fully automatic · manual only | Rejections are batched and delayed. Nothing leaves unseen. |
| 37 | WhatsApp? | **Email only; WhatsApp by hand, logged on the timeline** — adjusted for Q4 (★ was the Business API, later) | In v1 | — |
| 38 | Hiring-team notifications? | **Slack + email digest** ★ | Microsoft Teams · email only | Reuses the btnet Slack app pattern: nudges for scorecards and approvals. |

## 11 · Offers and hand-off — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 39 | How far does the app go on offers? | **Offer terms + approval + generated PDF letter; signing happens outside** — adjusted for Q4 (★ included e-sign) | Record terms only · out of scope | — |
| 40 | Legal entity, currency and pay structure per job/offer? | **Yes, per job and offer** ★ | Single entity/currency | For example the India EOR in INR (fixed + bonus) and a UK entity in GBP. |
| 41 | Pre-hire checks? | **References in-app; background checks outside, outcome recorded** ★ (fits Q4) | Vendor checks now · out of scope | Referees get a questionnaire link. |
| 42 | After "Hired"? | **Hand-off packet + onboarding checklist** ★ | Full onboarding module · stop at Hired | PDF/JSON packet for the EOR. |

## 12 · Analytics, AI and compliance — delegated

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 43 | How deep do analytics go? | **Funnel to question level** ★ | Funnel and counts · exports only | Funnel, time in stage, source quality, interviewer calibration, and which questions actually predict outcomes. |
| 44 | Can candidate data go to an LLM API (Claude)? | **Revised: local model only** (Ollama on the Studio). Candidate data never leaves the machine. | API with disclosure + redaction ★ · anonymised only | No LLM API for candidate data. Hosted models may still help author kits (Q20), which contain no personal data. |
| 45 | How long is candidate data kept? | **12 months for unsuccessful candidates; 24 with talent-pool consent; configurable per org** ★ | 6 months · indefinitely | Then anonymised. Covers UK tribunal claim windows with margin; compatible with UK GDPR and India's DPDP Act. |
| 46 | Which role kits come after Quant Trader? | **Software engineer (Rust/Python) and Quant researcher** — *assumed; confirm* | Ops / risk / finance · BD / investor relations | Each is drafted with AI (Q20) and published by a human. |

## 13 · Platform — delegated (Q50 answered by Hitesh)

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 47 | Stack? | **House stack** ★: NestJS + Prisma + Postgres, React + Vite + TS | Next.js full-stack · Python API | As built; matches the auction project and treasury-api. |
| 48 | Where does it run? | **Revised: on the Studio**, because the screening model lives there — with a UPS, a nightly off-site backup and an uptime alert. (★ was prod in a UK cloud region) | Studio for everything · cloud for both | **v0 runs on the Studio today** for speed. Move prod before candidate volume grows: a home power or network cut would drop a live interview. |
| 49 | Monthly budget for hosting and services? | **Up to £150/month** ★ | Up to £500 · not a constraint | **Revised:** the local model removes LLM API spend; what's left is off-site backups and a UPS. |
| 50 | Repo and product name? | **talent-os** (Hitesh) | hiring ★ · btnet-hiring | `BasisTradingDotNet/talent-os`. |

## 14 · Volume and local AI — answered by Hitesh (follow-up)

**Requirement:** screen about **500 applications a day**. A **locally run model** gives the interviewer
a summary and a classification for each one. At that volume, a 30-second human look per applicant is
already about four hours a day, so the model decides the order of work, not the outcome.

| # | Question | Decision | Other options | What it means |
|---|---|---|---|---|
| 51 | How far beyond hiring? | **Hiring + hand-off** ★ | Hiring + employee records · full HRIS | talent-os is G-20's hiring system of record up to "hired". Employee records stay with the EOR, and all effort goes into screening at volume. |
| 52 | What does the local model produce per application? | **Per-job screening rubric: a 0–3 score per criterion with a quoted line of evidence, a suggested tier (Strong / Possible / Unlikely), and a short summary** ★ | Fixed global tiers · summary + tags only | Screening becomes "stage 0" of the interview plan and reuses the kit machinery. A criterion with no quote is scored "unknown", never guessed. A human confirms the tier. |
| 53 | At 500/day, how are low-fit applicants rejected? | **Auto-reject on knockout rules Hitesh sets** | Human bulk-confirm ★ · auto-reject on AI tier | Only deterministic rules reject automatically (e.g. notice > 90 days); **AI tiers never reject**. Safeguards: knockouts are shown on the application form; rejection emails go out after a delay; every auto-rejection is logged and reversible; each carries a "request human review" link; no rule may touch protected characteristics. |
| 54 | Where do the 500/day come from? | **Careers site + tracked links** ★ and **the hiring@ mailbox** | Board exports · referrals and agencies | Boards link to the talent-os apply page. CVs emailed to `hiring@basistrading.net` are ingested and parsed automatically. |

**Model:** `qwen3.5:122b` is already installed on the Studio (M3 Ultra, 256 GB). Benchmark it against
`qwen38-27b` on about 50 hand-labelled synthetic CVs for accuracy against human tiers and for
throughput, then choose. The expected cost is roughly 10–20 s per CV, which puts 500 a day at a few
hours of background compute. Use a standard instruct model, not the uncensored variant also
installed there.

## Operational decisions made on the day

- **URL:** `https://hiring.basistrading.net` (Hitesh). The console sits behind Cloudflare Access
  (`hiteshbhatia3559@gmail.com`). Only `/c/*`, `/api/candidate/*` and `/assets/*` bypass it.
- **Today's interview covers every stage**, so v0 supports S1, Sets A/B/C, take-home marking and S4.
- **Merges wait for Hitesh's review.** Today's deploy runs from a locally assembled branch, and
  `main` changes only through reviewed PRs.
