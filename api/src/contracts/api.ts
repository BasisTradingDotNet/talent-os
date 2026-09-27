/**
 * talent-os HTTP contract — TYPES ONLY, no runtime code.
 *
 * Shared by api/ (controllers return exactly these shapes) and ui/ (imports them through the
 * `@contracts` alias). FROZEN for v0: change it only through the orchestrator, never inside a
 * feature branch. If you need something it does not have, say so in your report.
 *
 * Conventions
 * - JSON over HTTP, everything under /api.
 * - Timestamps are ISO-8601 UTC strings. IDs are opaque strings.
 * - Question keys are the kit's own ids: "A5", "S1.3", "T2".
 * - A "section" is one runnable unit of a kit: a stage, or a set within a stage
 *   (Quant kit: S1, A, B, C, T, S4).
 */

// ---------------------------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------------------------

export type SectionKey = string;
export type Scoring = 'rubric' | 'dimensions';
export type Domain = 'quant' | 'python' | 'screening' | 'judgement' | 'takehome';
export type Mode = 'verbal' | 'sheet' | 'sheet-or-verbal' | 'sheet-and-verbal' | 'take-home';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Score = 0 | 1 | 2 | 3;

export interface Dataset {
  format: 'csv';
  text: string;
}

export interface CodeBlock {
  language: string;
  text: string;
}

export interface Rubric {
  '3': string;
  '2': string;
  '1': string;
  '0': string;
}

/** A section total >= min earns the label. Sorted ascending by min. Below every band = fail. */
export interface Band {
  min: number;
  label: string;
}

export interface DimensionDef {
  id: number;
  name: string;
}

export interface DomainGroup {
  domain: Domain;
  label: string;
}

export interface SectionDef {
  key: SectionKey;
  stage: number;
  /** Interviewer-facing, e.g. "Set A — Easy (screening)". */
  label: string;
  /** Candidate-facing, e.g. "Written test — Part A". Never reveals difficulty or topic. */
  candidateLabel: string;
  /** rubric = each question scored 0–3; dimensions = scorecard dimensions rated 1–5. */
  scoring: Scoring;
  /** Whole-section time guide in minutes. */
  timeMinutes: number | null;
  /** Rubric sections: question count × 3. Null for dimension sections. */
  maxScore: number | null;
  /** Rubric sections: configurable thresholds. [] for dimension sections. */
  bands: Band[];
  /** Dimension sections: which dimensions are rated 1–5. [] for rubric sections. */
  dimensionIds: number[];
  /** e.g. ["Proceed", "Hold", "Decline"]. [] when the section has no recommendation. */
  recommendationOptions: string[];
  /** Sub-totals to report, e.g. quant and python. [] for none. */
  domainGroups: DomainGroup[];
  /** True when the candidate follows along on a token link (the Stage 2 sets). */
  candidateView: boolean;
  /** Show Kit.candidateInstructions on the candidate's intro screen. */
  showInstructions: boolean;
  /** Markdown shown to the interviewer above the console (e.g. the take-home brief). */
  interviewerNotes: string | null;
  /** Question keys in running order. */
  questionKeys: string[];
}

export interface Question {
  id: string;
  key: string;
  section: SectionKey;
  stage: number;
  number: number;
  title: string;
  domain: Domain;
  difficulty: Difficulty | null;
  mode: Mode;
  timeMinutes: number | null;
  /** Markdown. */
  prompt: string;
  dataset: Dataset | null;
  code: CodeBlock | null;
  /** Markdown. Hidden by default in the console. */
  modelAnswer: string | null;
  /** Hidden by default in the console. */
  rubric: Rubric | null;
  /** Hidden by default in the console. */
  trapOrBonus: string | null;
  /** Stage 1/4 guidance (markdown). Hidden by default in the console. */
  whatGoodLooksLike: string | null;
}

export interface Kit {
  id: string;
  slug: string;
  title: string;
  version: string;
  jobTitle: string;
  /** Markdown. Shown to candidates at the start of sections with showInstructions. */
  candidateInstructions: string;
  dimensions: DimensionDef[];
  sections: SectionDef[];
  questions: Question[];
}

// GET  /api/kit                      → Kit   (the org's active kit, answers included)
// PUT  /api/kit/sections/:key/bands  body: Band[] → Kit   (thresholds are configurable)

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

// GET /api/me → Me
export interface Me {
  email: string;
  org: { id: string; name: string };
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export type SessionStatus = 'ready' | 'live' | 'completed';

export interface ResponseRecord {
  questionKey: string;
  score: Score | null;
  notes: string;
  trapNoticed: boolean;
  bonusGiven: boolean;
  skipped: boolean;
  markedForReturn: boolean;
  timeSpentSeconds: number;
  updatedAt: string;
}

export interface DimensionRating {
  dimensionId: number;
  /** 1–5, or null when not yet rated. */
  rating: number | null;
  note: string;
}

export interface Subtotal {
  domain: Domain;
  label: string;
  total: number;
  max: number;
}

export interface Verdict {
  total: number;
  max: number;
  /** Questions with a score. */
  scored: number;
  skipped: number;
  /** Every question in the section is scored or skipped. */
  complete: boolean;
  subtotals: Subtotal[];
  /** Highest band reached, or null when below every band. */
  band: Band | null;
  /** band.label, or "Below threshold". Only meaningful once complete. */
  result: string;
}

export interface Session {
  id: string;
  candidateId: string;
  candidateName: string;
  section: SectionKey;
  kitId: string;
  kitVersion: string;
  status: SessionStatus;
  interviewer: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** What the candidate sees right now. Null = intro screen (live) or waiting (ready). */
  presentedQuestionKey: string | null;
  /** When the presented question was presented: the per-question timer origin. */
  presentedAt: string | null;
  /** Absolute URL of the candidate link. Null when the section has no candidate view. */
  candidateUrl: string | null;
  /** Set-level ad-hoc notes. */
  setNotes: string;
  recommendation: string | null;
  /** One entry per question that has been touched; missing = untouched. */
  responses: ResponseRecord[];
  /** Dimension sections only; one entry per dimension that has been touched. */
  ratings: DimensionRating[];
  /** Rubric sections only. */
  verdict: Verdict | null;
  /** Server clock, for client-side timer offset. */
  serverNow: string;
}

// POST  /api/sessions                             body: CreateSession   → Session
// GET   /api/sessions/:id                                               → Session
// POST  /api/sessions/:id/start                                         → Session   (ready → live)
// POST  /api/sessions/:id/present                 body: PresentQuestion → Session
// PUT   /api/sessions/:id/responses/:questionKey  body: UpdateResponse  → Session   (partial upsert)
// PUT   /api/sessions/:id/ratings/:dimensionId    body: UpdateRating    → Session   (partial upsert)
// PATCH /api/sessions/:id                         body: UpdateSession   → Session
// POST  /api/sessions/:id/end                                           → Session   (→ completed)
// POST  /api/sessions/:id/reopen                                        → Session   (completed → live)

export interface CreateSession {
  candidateId: string;
  section: SectionKey;
}

export interface PresentQuestion {
  /** Null returns the candidate to the intro screen. */
  questionKey: string | null;
}

export interface UpdateResponse {
  score?: Score | null;
  notes?: string;
  trapNoticed?: boolean;
  bonusGiven?: boolean;
  skipped?: boolean;
  markedForReturn?: boolean;
}

export interface UpdateRating {
  rating?: number | null;
  note?: string;
}

export interface UpdateSession {
  setNotes?: string;
  recommendation?: string | null;
  interviewer?: string;
}

// ---------------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------------

export interface SessionSummary {
  id: string;
  section: SectionKey;
  status: SessionStatus;
  interviewer: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  verdict: Verdict | null;
  ratings: DimensionRating[];
  recommendation: string | null;
  trapsNoticed: number;
  bonusesGiven: number;
  /** A newer session exists for the same section (a re-sit). Old sessions are retained. */
  superseded: boolean;
}

export interface CandidateSummary {
  id: string;
  applicationId: string;
  name: string;
  email: string | null;
  source: string | null;
  createdAt: string;
  /** Highest stage with a session; 0 when none. */
  stageReached: number;
  /** Latest non-superseded session per section key. Absent key = never run. */
  latest: Record<SectionKey, SessionSummary>;
  overallDecision: string | null;
}

export interface CandidateDetail extends CandidateSummary {
  notes: string | null;
  level: string | null;
  compNote: string | null;
  /** Every session, newest first. */
  sessions: SessionSummary[];
}

// GET   /api/candidates        → CandidateSummary[]   (newest first; also feeds the comparison table)
// POST  /api/candidates        body: CreateCandidate → CandidateDetail
// GET   /api/candidates/:id    → CandidateDetail
// PATCH /api/candidates/:id    body: UpdateCandidate → CandidateDetail

export interface CreateCandidate {
  name: string;
  email?: string;
  source?: string;
  notes?: string;
}

export interface UpdateCandidate {
  name?: string;
  email?: string | null;
  source?: string | null;
  notes?: string | null;
  overallDecision?: string | null;
  level?: string | null;
  compNote?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------

// GET /api/export/candidates.csv        → text/csv attachment, one row per candidate
// GET /api/export/candidates/:id.json   → CandidateScorecard attachment

export interface CandidateScorecard {
  exportedAt: string;
  kit: { slug: string; version: string; title: string };
  candidate: CandidateDetail;
  sessions: Session[];
}

// ---------------------------------------------------------------------------------------------
// Candidate view — PUBLIC, token-gated. The only unauthenticated data endpoint.
// ---------------------------------------------------------------------------------------------

// GET /api/candidate/:token/state → CandidateState   (404 for unknown tokens)

export type CandidatePhase = 'waiting' | 'intro' | 'question' | 'ended';

export interface CandidateQuestion {
  /** 1-based position within the section. */
  position: number;
  total: number;
  prompt: string;
  dataset: Dataset | null;
  code: CodeBlock | null;
  timeMinutes: number | null;
}

/**
 * ALLOWLIST BY CONSTRUCTION. Never add a question title, key, model answer, rubric, trap note,
 * score, note, flag, other questions, or anything about other candidates. A question title alone
 * can give the answer away ("Mutable default argument").
 */
export interface CandidateState {
  phase: CandidatePhase;
  orgName: string;
  /** SectionDef.candidateLabel. */
  sectionLabel: string;
  /** Kit.candidateInstructions when phase === 'intro' and the section shows instructions. */
  instructions: string | null;
  question: CandidateQuestion | null;
  presentedAt: string | null;
  serverNow: string;
  /** Bumps on every change the candidate should see. */
  version: number;
}

// GET /api/health → { ok: true }   (unauthenticated)
