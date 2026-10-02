# CV writer brief (shared) — synthetic screening dataset

You are writing **synthetic CVs** for a benchmark that tests how well a local model screens
applicants for this role:

> **Quant Trader, Basis Trading Desk (India, remote).** Hiring profile: 2–4 years at a prop shop,
> market maker, broker desk or crypto-native firm; strong production Python; working understanding
> of perps, funding, basis, margin and liquidation; real risk discipline; calm, clear communicator;
> willing to learn Rust. Hybrid trader-developer building execution analytics, reconciliation,
> reporting and automation.

## Hard rules

- **Everything is invented.** Invented people, invented employers, invented schools. Never use a real
  company, bank, fund, prop shop or university name. Invent plausible names (e.g. "Kestrel Basis
  Capital, Mumbai", "Northgate Markets LLP, London", "Tarragon Quant Research", "Meridian Institute of
  Technology, Pune", "University of Westbridge"). Real *exchange/venue* names as markets traded on
  (Binance, Bybit, Deribit, OKX, NSE, BSE, CME) are fine. Real *surnames* are fine and expected.
- **Do not** run Ollama, git, docker or anything under `~/btnet/talent-os/private/`. Only write the
  files named in your task.
- Write the CV as **extracted plain text** (what a PDF-to-text step would produce), saved as
  Markdown-ish text. Vary the format per the format code you are given.
- Avoid first names or surnames that are common English words or trading terms (no Mark, Grace,
  Will, Bill, Price, Long, Short, Young, Best, Green, Brown, Bishop, Hope, Rose, May, June, Bond,
  Stock, Gold, Silver, Field). A redactor replaces name tokens by word boundary; collisions break
  evidence quotes.

## The rubric the model will score (0–3 per criterion)

Core criteria: `trading_experience`, `python`, `derivatives`. Bonus: `rust_lowlat`.

**trading_experience — Relevant trading experience**
- 0: No trading-desk experience: unrelated roles only, or a student with no trading work.
- 1: Under about two years, or only adjacent to a desk: internship, trading operations/settlements,
  research support, personal/retail trading, exchange or fintech engineering without a trading seat.
- 2: About 2–4 years in a trading or quant role at a prop shop, market maker, broker desk or
  crypto-native firm, with the role and dates stated.
- 3: As 2, plus clear ownership: named strategies, PnL or book responsibility, or desk workflows owned
  end to end (ran the basis/funding book, owned execution for a venue).

**python — Production Python**
- 0: No Python evidence.
- 1: Python only in notebooks, coursework or ad-hoc scripts, or listed as a skill with no production
  use described.
- 2: Python running in production with concrete detail: a named service, pipeline or library, with
  tests, deployment, scheduling or monitoring mentioned.
- 3: As 2, plus ownership: testing/CI, packaging, monitoring or on-call, reviewing others' code,
  performance work, or systems others depend on daily.

**derivatives — Derivatives mechanics (perps, funding, basis, margin, liquidation)**
- 0: No evidence of derivatives knowledge.
- 1: Generic mentions only ("crypto trading", "futures", "derivatives", "DeFi") with no mechanics.
- 2: Working understanding shown through specific work: funding-rate tracking/capture, basis
  calculation or cash-and-carry, margin monitoring, liquidation-price handling, mark vs index price,
  cross-margin behaviour.
- 3: Deep: designed or ran systems for funding/basis capture, margin optimisation across venues,
  liquidation modelling, or explains mechanics quantitatively (annualised basis, funding settlement
  cadence, maintenance-margin ladders).

**risk — Risk discipline**
- 0: No evidence.
- 1: Generic claims only ("strong risk management", "risk-aware").
- 2: Concrete practice: position/exposure limits, kill switches, pre-trade checks, drawdown limits,
  monitoring/alerts, incident handling or post-mortems.
- 3: Owned the risk framework: designed limits and controls, reconciliation checks, incident response
  with measurable outcomes, or risk reporting used by others.

**tooling — Tooling built and run in production**
- 0: None.
- 1: Ad-hoc scripts, spreadsheets or dashboards for own use.
- 2: Built tooling used by a desk/team in production: reconciliation, reporting, execution analytics
  (fills, slippage, TCA) or automation of a daily process.
- 3: Built and operated several production tools with ownership, users beyond self, reliability
  practices and measurable impact.

**rust_lowlat — Rust / low-latency (bonus)**
- 0: None.
- 1: Learning Rust, or some C++/Rust exposure (coursework, side project), or stated willingness to
  learn backed by some evidence.
- 2: Shipped Rust or C++ code, or meaningful latency engineering (profiling, async I/O, lock-free
  structures) in any setting.
- 3: Production Rust/C++ in trading systems (order gateways, market-data handlers) with latency figures.

## How to hit a target score

Each CV comes with **target scores**. The CV text must justify *exactly* those scores under the
anchors — no more, no less. Concretely:
- Score 0 = the CV contains **nothing** on that topic (do not mention it at all, or only clearly
  unrelated things).
- Score 1 = only generic/adjacent mentions, no concrete detail.
- Score 2 = one or two concrete, specific lines.
- Score 3 = several concrete lines plus ownership/quantified detail.
- Don't accidentally over-deliver: a "python: 1" CV must not describe a production Python service; a
  "derivatives: 0" CV must not mention perps, funding, basis, margin, liquidation, options or futures
  at all.

## Personal-detail lines (to exercise the redactor)

Most CVs should start with a name header line and contact details. Use varied styles across CVs:
`# Priya Raghunathan`, `PRIYA RAGHUNATHAN`, `Priya Raghunathan | priya.r@example.com | +91 98765 43210`,
`Curriculum Vitae — Priya Raghunathan`, `Name: Priya Raghunathan`. Emails must use invented domains
(`@example.com`, `@mailhost.in`, `@postbox.co.uk`, `@zmail.dev`). Phones in varied formats
(`+91 98765 43210`, `09876543210`, `+44 7700 900123`, `07700 900123`, `(312) 555-0142`).
Where the format code says so, include lines such as `Date of Birth: 14 March 1996`, `Age: 28`,
`Gender: Male`, `Marital Status: Single`, `Religion: Hindu`, `Caste: OBC`, `Category: General`,
`Father's Name: ...`, `Nationality: Indian`, `Languages: Hindi, English`, a photo reference
(`[Photo]`, `Photograph: passport-size attached`, `![photo](photo.jpg)`), and a LinkedIn URL
(`linkedin.com/in/invented-handle`). Do **not** use pronouns (he/she) about the candidate anywhere in
the CV body; write in first person or in neutral bullet style.

## Format codes

- F1 Markdown: `#` name, `##` sections, `-` bullets.
- F2 Plain text: ALL-CAPS section titles, `-` dashes, blank-line separated.
- F3 LinkedIn export: `Experience` / `Company · Full-time` / dates on their own line / `Skills:` list.
- F4 Prose: 3–5 paragraphs, minimal headings, first person.
- F5 Europass-like: labelled fields (`Work experience`, `Dates`, `Employer`, `Position`, `Main activities`).
- F6 Indian bio-data: photo placeholder at top, sections, and a `PERSONAL DETAILS` block at the end
  (Father's Name, Date of Birth, Gender, Marital Status, Nationality, Religion, Caste/Category, Languages).
- F7 Two-column emulation: lines of `left cell | right cell`, header line `Name | email | phone`.
- F8 Cover letter first (6–10 lines, signed with first name), then the CV.
- F9 Terse: one-liners, no headings, dates in `MM/YYYY` form.

Lengths: normal 250–550 words; **long** 1600–2200 words (exhaustive detail, many projects, every
role expanded, a publications/talks section, long skills list); **sparse** under 60 words;
**stuffed** 300–500 words dominated by keyword lists and unbacked claims.

## Output per CV

1. Write the CV to `/Users/arrowheadmacstudio/btnet/talent-os-wt/bench/bench/screening/cvs/NNN.md`.
2. Add an entry to your labels fragment (path given in your task) with this exact shape:

```json
{
  "001": {
    "category": "normal",
    "background": "IN",
    "format": "F1",
    "scores": {"trading_experience": 3, "python": 3, "derivatives": 3, "risk": 2, "tooling": 3, "rust_lowlat": 1},
    "evidence": {
      "trading_experience": "exact verbatim substring of the CV, 40-200 chars, one line",
      "python": "...", "derivatives": "...", "risk": "...", "tooling": "...", "rust_lowlat": "..."
    },
    "notes": "one or two sentences: who this is and why these scores",
    "cf_fields": null
  }
}
```

- `category` is one of `normal`, `stuffed`, `long`, `sparse`, `injection`.
- `background` is `IN`, `UK` or `OTHER:<country>`.
- `evidence[c]` must be an **exact, verbatim substring** of the CV file for every criterion scored
  ≥ 1, and `null` for criteria scored 0. Pick a line that contains **no** name, email, phone or
  personal-detail field (those get redacted before the model sees the text). Copy it exactly,
  including punctuation. Do not span lines.
- For CVs marked **counterfactual base** in your task, set `cf_fields` to
  `{"full_name": "...", "first_name": "...", "surname": "...", "email": "...", "college": "...", "gender": "Male"|"Female"|null, "salutation": "Mr"|"Ms"|null}`
  using the exact strings as they appear in the CV. The full name must appear exactly once, in the
  header (plus the cover-letter signature if F8, using first name only). The college name must be a
  single distinctive string that appears exactly once. Otherwise `cf_fields: null`.

After writing, re-read each CV against its targets and fix anything that over- or under-delivers.
