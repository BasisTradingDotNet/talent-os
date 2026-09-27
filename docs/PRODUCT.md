# talent-os — product scope

**Status:** v0 shipped 2026-09-27 (live interview console). This document extends the original
Quant Trader Interview Kit spec (its Section 0) into a role-agnostic hiring pipeline. Every
decision cited as *Qn* is recorded in [SCOPING.md](SCOPING.md).

## 1. What it is

talent-os runs hiring for G-20 Group from requisition to hand-off. The spine is the one the Quant
Trader kit already implies:

> a **job** has an **interview plan**; each **stage** runs a versioned **interview kit**; interviewers
> score in a **live console** while the candidate follows a **token link** that shows only what they
> need; **scorecards** roll up into a **decision** a human makes; an **offer** and a **hand-off** follow.

Generalise that spine and any role becomes configuration: a kit, a template and thresholds. The Quant
kit is the first set of seed data, not a special case.

**Where the effort goes.** The parts Greenhouse-style systems do poorly are the ones worth building:
- the two-screen live console with hidden rubrics;
- per-candidate datasets and question variants;
- question-level analytics that show which questions actually predict a good hire;
- AI-drafted kits with machine-verified answers.

Commodity pieces stay outside the app, and the app records their outcome (Q4). These are
e-signature, background checks, video, job-board posting and messaging vendors.

## 2. Principles

1. **Humans decide.** Thresholds suggest; nothing advances, rejects or emails a candidate on its own (Q10, Q36).
2. **The candidate sees an allowlist.** Candidate-facing payloads are built field by field from an explicit contract. A question title can leak an answer, so titles are never shown.
3. **Structured evidence over impressions.** Rubric-anchored scores, blind feedback until submission, and no composite score that hides a candidate's shape (Q8, Q26).
4. **Pinned versions.** A session records the kit version it ran, so scores stay comparable and auditable.
5. **Role-agnostic and multi-org.** Every row is org-scoped (Q1). No role-specific logic lives in code.
6. **Confidential by default.** Kits with answers never enter git (Q17). There is no PII in logs, and retention is enforced (Q45).
7. **Never execute candidate code** (Q21, Q31).
8. **Record what happens outside** (Q4). Offers are signed, checks run and calls happen elsewhere; the app stores the outcome.

## 3. Users

| Role | Does |
|---|---|
| **Admin** | Org settings, users, templates, retention, thresholds |
| **Hiring manager** | Owns a job and its plan; runs interviews; proposes decisions |
| **Interviewer / panellist** | Runs or joins sessions for candidates they're assigned; scores privately |
| **Approver (leadership)** | Signs off hire decisions and offer terms (Q11) |
| **Coordinator** | Logistics: candidates, slots, emails (can be the hiring manager on a small desk) |
| **Candidate** | Applies, follows live tests on a token link, uploads take-homes, sees status (portal, Q7) |
| **Referee** | Answers a reference questionnaire via a one-off link (Q41) |

## 4. Core model

```
Organization ─┬─ Department / Location / LegalEntity (Q40)
              ├─ User ── Role; HiringTeam membership per Job (Q5)
              ├─ Job ── Opening(s) ── InterviewPlan (from a Template, Q9)
              │           └─ Stage[] ── Kit version (pinned) ── Section[] ── Question[] (bank refs, Q18)
              ├─ Candidate (person) ── Application (candidate × job) ── StageProgress
              │     ├─ Session (a stage/section run; token link) ── Response[] / Rating[]
              │     ├─ Scorecard (per panellist; blind until submitted) ── Decision (+ approvals)
              │     ├─ Assessment (take-home: seeded dataset, window, submission, marks)
              │     ├─ Offer (terms, approval, letter; signed outside) ── HandOff packet
              │     └─ Activity timeline (emails, notes, stage moves, outside events)
              └─ QuestionBank / KitTemplates / EmailTemplates / RetentionPolicy
```

v0 implements the subset that the console needs: Organization, Job, Kit (versioned) with Sections and
Questions, Candidate, Application, Session, Response and Rating. It is multi-org from the first
migration.

### How the Quant Trader kit maps

| Kit concept | talent-os concept |
|---|---|
| Stage 1 intro call | Section `S1` · dimension scoring (dims 1, 5, 6, 7 rated 1–5) · Proceed / Hold / Decline |
| Stage 2 Sets A, B, C | Sections `A`, `B`, `C` · rubric scoring 0–3 · bands 24 / 20 / 15 & 20 · quant/python sub-totals from question domains |
| Stage 3 take-home | Section `T` · the six rubric criteria as questions · band 12/18 |
| Stage 4 final round | Section `S4` · dimension scoring (dims 4–7 + leadership view) · Hire / Hire with training plan / No hire |
| Trap / bonus flags | `trapNoticed` / `bonusGiven` on each response, counted on the scorecard and the comparison table |
| Section 8 scorecard | Printable scorecard page + JSON export |
| Section 9 index | Parser cross-check: every record must match its index row |

## 5. Modules and phasing

**v0** shipped today. **Phase 1** makes it a pipeline for the Quant search. **Phase 2** makes it a
full ATS. **Later** means once the need shows up.

### 5.1 Orgs & access
- **v0:** single org (`g20`), Cloudflare Access gate, interviewer identity from Access.
- **Phase 1:** users and roles, per-job hiring teams (Q5), Microsoft 365 SSO (Q6), audit log, Access JWT verification.
- **Phase 2:** second org (a venture), per-org branding, legal entities (Q40).

### 5.2 Jobs & interview plans
- **Phase 1:** jobs and openings; interview-plan templates cloned per job (Q9); the Quant plan as the first template; stage gates as suggestions (Q10).
- **Phase 2:** approval records for decisions and offers (Q11).

### 5.3 Careers & intake
- **Phase 1:** bulk CSV import (Q15), manual add, duplicate detection.
- **Phase 2:** hosted careers pages with Google for Jobs markup and tracked per-board links (Q13, Q14); application forms with knockout questions; referral links; sourced prospects; AI CV parsing and summaries (Q16).

### 5.4 Candidates & CRM
- **v0:** candidate profile, notes, overall decision, level, comp note.
- **Phase 1:** applications (one person, many jobs), activity timeline, documents, tags.
- **Phase 2:** rejection-reason taxonomy, opt-in talent pool (Q12), candidate portal (Q7).

### 5.5 Pipeline
- **Phase 1:** stage board (kanban), bulk moves, rejection with reasons, stale-candidate alerts, human-confirmed stage emails (Q36).

### 5.6 Kits & question bank
- **v0:** versioned kits seeded from Markdown via `kit/parse-kit.ts`, with the Section 9.1 cross-check; configurable thresholds.
- **Phase 1:** in-app kit editor with Markdown import/export (Q17); shared versioned question bank (Q18).
- **Phase 2:** AI kit drafting from a job description, with code-verified numeric answers (Q20); parameterised variants (Q19); the next kits: software engineer and quant researcher (Q46).

### 5.7 Live console (Section 0 of the original kit, generalised)
- **v0:**
  - Interviewer console: navigator, presentation separate from peeking, hidden-by-default answers/rubrics/traps, 0–3 scoring, notes, flags, skip/mark, timers, running totals, verdicts.
  - Dimension scorecards for S1/S4.
  - Candidate view on a token link: prompt, dataset table, copy as TSV, code, timer.
- **Phase 1:** multi-panellist sessions with one driver and private scoring (Q22); integrity soft signals (Q24).
- **Later:** built-in grid and code pad, if external tools stop being enough (Q21).

### 5.8 Scorecards & decisions
- **v0:** per-session scores and ratings, comparison table, printable Section-8 scorecard, JSON and CSV exports.
- **Phase 1:** blind submission (Q8), scorecard deadlines with Slack nudges (Q38), debrief page with recorded rationale (Q25), amendments after submit append with a reason.

### 5.9 Assessments (take-homes)
- **v0:** marking against the six-criterion rubric in the console.
- **Phase 2:**
  - Portal delivery with a timed window (Q28).
  - Per-candidate seeded datasets with planted features and answer keys (Q29), using the kit's Section 6.2 generator spec.
  - AI-use declaration (Q30).
  - Results-CSV diff against the key (Q31).
  - Anonymised marking (Q8).

### 5.10 Scheduling
- **Phase 1:** record interview slots; ICS invites (Q32). Scheduling itself happens in Outlook.
- **Later:** Microsoft 365 free/busy and self-booking, the first integration to revisit (Q32, Q33); interviewer qualifications and shadowing (Q34).

### 5.11 Communication
- **Phase 1:** Slack and email-digest notifications for the hiring team (Q38).
- **Phase 2:**
  - Email templates with merge fields.
  - Sending from the shared `hiring@basistrading.net` M365 mailbox via SMTP, with a log on the timeline (Q35).
  - Human-confirmed automations (Q36).
  - Templated rejection reason with an optional personal note (Q27).
  - WhatsApp stays manual and is logged (Q37).

### 5.12 Offers & hand-off
- **Phase 2:**
  - Offer terms per legal entity and currency (Q40).
  - Leadership approval (Q11).
  - Generated PDF letter; signing happens outside (Q39).
  - Reference questionnaires (Q41).
  - Hand-off packet and onboarding checklist (Q42).

### 5.13 Analytics
- **v0:** cross-candidate comparison with sub-totals and flags.
- **Phase 2:** funnel, time in stage, source quality, interviewer calibration (score distributions per panellist), and question item analysis showing which questions discriminate between hires and non-hires (Q43).

### 5.14 Compliance & AI
- **Phase 1:**
  - Privacy notice on candidate pages.
  - Retention job: anonymise unsuccessful candidates after 12 months, or 24 with consent (Q45).
  - DSAR export and erasure.
- **Phase 2:** Claude API features limited to summaries and drafts, never decisions; disclosed; contact details redacted (Q16, Q20, Q23, Q44).

## 6. Roadmap

| Phase | Goal | Exit criteria |
|---|---|---|
| **v0** (27 Sep 2026) | Run the Quant Trader interview on the app today | All four stages usable; candidate view leak-free; data persisted; published behind Access |
| **Phase 1** (≈ 2–3 weeks) | A pipeline for the Quant search | Jobs + templates, applications, stage board, CSV import, users/roles/SSO, multi-panellist sessions, blind scorecards, debrief + decision record, Slack nudges, Access JWT verification, backups, **prod moved to a UK cloud region** (Q48) |
| **Phase 2** (≈ 6–8 weeks) | A full ATS for any role | Careers site + tracked links, candidate portal, take-home portal with seeded datasets, email templates + SMTP, offers + references + hand-off, analytics, AI CV summaries + kit drafting, retention |
| **Later** | Grow with the desk | M365 calendar/self-booking, interviewer qualifications, question variants at scale, transcripts to draft notes, a second org |

## 7. Out of scope

- Payroll, HRIS and onboarding beyond the hand-off checklist (Q42).
- E-signature, background checks, video conferencing and job-board posting — done outside, recorded in-app (Q4).
- Automated rejection or ranking of candidates (Q10, Q16).
- Executing candidate code (Q21, Q31).
- Selling talent-os as SaaS (Q1). The schema keeps that option open without building for it.
