/**
 * talent-os HTTP contract — TYPES ONLY, no runtime code.
 *
 * Shared by api/ (controllers return exactly these shapes) and ui/ (imports them through the
 * `@contracts` alias). FROZEN: change it only through the orchestrator, never inside a feature
 * branch. If you need something it does not have, say so in your report.
 *
 * v1 (2026-09-27): recorded written test. Candidates type answers in the app while the
 * interviewer drives the session live, and the candidate's browser records camera + microphone and
 * the entire screen, uploaded in chunks. Recordings are kept 90 days after the hiring decision.
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
  /** What the candidate typed in the app for this question (v1). Null = nothing typed. */
  candidateAnswer: string | null;
  candidateAnswerAt: string | null;
  /** First time this question was presented; used to jump recordings to the question (v1). */
  firstPresentedAt: string | null;
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
  /** v1: recording consent and uploaded segments. */
  recording: SessionRecording;
  /** v1: integrity timeline reported by the candidate's browser, oldest first. */
  events: IntegrityEvent[];
}

// ---- v1: recording + integrity -------------------------------------------------------------

export type RecordingStream = 'camera' | 'screen';

export interface RecordingSegment {
  id: string;
  /** camera = webcam + microphone; screen = entire screen, no audio. */
  stream: RecordingStream;
  mimeType: string;
  startedAt: string;
  /** Null while recording, or when the page closed without stopping. */
  endedAt: string | null;
  lastChunkAt: string | null;
  bytes: number;
  chunks: number;
}

export interface SessionRecording {
  /** Set at session creation; the candidate must consent and share devices before starting. */
  required: boolean;
  consentAt: string | null;
  segments: RecordingSegment[];
}

export type IntegrityEventType =
  | 'page_loaded'
  | 'consent_given'
  | 'devices_ready'
  | 'screen_share_stopped'
  | 'screen_share_resumed'
  | 'camera_stopped'
  | 'tab_hidden'
  | 'tab_visible'
  | 'window_blur'
  | 'window_focus'
  | 'paste'
  | 'copy';

export interface IntegrityEvent {
  type: IntegrityEventType;
  /** Server receive time. */
  at: string;
  /** Candidate's clock, as reported. */
  clientAt: string | null;
  /** Question presented when the server received it (server-derived, never client-supplied). */
  questionKey: string | null;
  /** Short and non-content only, e.g. "412 chars" for a paste. Never the pasted text. */
  detail: string | null;
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
// GET   /api/sessions/:id/recordings/:segmentId   → the media file (Content-Type = segment mimeType),
//                                                   HTTP Range supported for seeking. PROTECTED.

export interface CreateSession {
  candidateId: string;
  section: SectionKey;
  /** v1. Default: section.candidateView. False = no consent/recording (e.g. an adjustment). */
  recordingRequired?: boolean;
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
  /** v1: at least one recording segment exists. */
  recorded: boolean;
  /** v1: count of tab_hidden, window_blur, paste, screen_share_stopped and camera_stopped events. */
  integrityFlags: number;
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
  /** v1: when overallDecision was last set (null when unset). Starts the 90-day recording clock. */
  decisionAt: string | null;
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

// GET  /api/candidate/:token/state                              → CandidateState   (404 for unknown tokens)
// v1 — all token-gated, rate-limited, and scoped to the token's own session:
// POST /api/candidate/:token/consent               body: ConsentRequest  → CandidateState
// PUT  /api/candidate/:token/answer                body: SaveAnswer      → SavedAnswer
//        409 unless the question at `position` is presented now or was presented earlier.
// POST /api/candidate/:token/recordings            body: StartRecording  → StartedRecording
//        409 unless consent was given; allowed while the session is ready or live.
// PUT  /api/candidate/:token/recordings/:segmentId/chunks/:seq   raw bytes → ChunkAck
//        seq starts at 0 and is contiguous: seq < next → 200 no-op (duplicate), seq > next → 409.
//        Max 8 MB per chunk, 6 GB per session.
// POST /api/candidate/:token/recordings/:segmentId/stop                  → 204
// POST /api/candidate/:token/events                body: CandidateEvents → 204   (max 50 per call)

export interface ConsentRequest {
  accepted: true;
}

export interface SaveAnswer {
  /** CandidateQuestion.position. */
  position: number;
  /** Max 20,000 characters. */
  text: string;
}

export interface SavedAnswer {
  savedAt: string;
}

export interface StartRecording {
  stream: RecordingStream;
  /** e.g. "video/webm;codecs=vp8,opus". Must start with video/webm or video/mp4. */
  mimeType: string;
}

export interface StartedRecording {
  segmentId: string;
}

export interface ChunkAck {
  /** Number of chunks stored for the segment so far. */
  received: number;
}

export interface CandidateEvents {
  events: { type: IntegrityEventType; clientAt: string; detail?: string }[];
}

/** v1: what the candidate's page needs to gate the test behind consent and device checks. */
export interface CandidateRecording {
  required: boolean;
  consentGiven: boolean;
  /** Plain-text notice the candidate accepts (versioned server-side). Null when not required. */
  consentText: string | null;
}

/** v1: the candidate's own saved answer for the presented question, so a refresh restores it. */
export interface CandidateAnswer {
  text: string;
  savedAt: string | null;
}

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
  /** v1. */
  recording: CandidateRecording;
  /** v1. The candidate's own answer for the presented question; null outside phase 'question'. */
  answer: CandidateAnswer | null;
}

// GET /api/health → { ok: true }   (unauthenticated)
