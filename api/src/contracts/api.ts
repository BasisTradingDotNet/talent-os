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
 * v1.1 (2026-09-27): section time limits. A started session counts down section.timeMinutes plus
 * any interviewer extensions; when it runs out the candidate's answers lock (15 s grace for the
 * final autosave). The interviewer ends the session; recording continues until then.
 *
 * v1.3 (2026-09-27): cancel an unused candidate link (SessionStatus 'cancelled').
 *
 * v1.2 (2026-09-27): multiple-choice (auto-scored, negative marking) and self-paced sections —
 * the candidate starts, navigates and submits within the time limit — plus local transcription of
 * recordings with AI-drafted interviewer notes (whisper.cpp + a local model; never a score).
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
/**
 * rubric = 0–3 by the interviewer; dimensions = 1–5 ratings; auto = multiple choice scored by the
 * app (v1.2); market = make-a-market games, the interviewer trading against the candidate (v1.2).
 */
export type Scoring = 'rubric' | 'dimensions' | 'auto' | 'market';
export type Domain =
  | 'quant' | 'python' | 'screening' | 'judgement' | 'takehome'
  | 'math' | 'probability' | 'statistics'; // v1.2
export type Mode = 'verbal' | 'sheet' | 'sheet-or-verbal' | 'sheet-and-verbal' | 'take-home' | 'mcq' | 'market'; // mcq, market: v1.2

/**
 * v1.2: a make-a-market template (Question.market). NEVER sent to candidates.
 * dice: the server rolls `dice` dice with `sides` sides when the game starts and reveals one die per
 *   "reveal"; the true value is the sum. estimate: an uncertain quantity with a known answer.
 */
export type MarketConfig =
  | { kind: 'dice'; dice: number; sides: number }
  | { kind: 'estimate'; trueValue: number; unit: string; hints: string[] };
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

/** v1.2: points per multiple-choice answer, e.g. { correct: 1, wrong: -0.25, blank: 0 }. */
export interface AutoScoring {
  correct: number;
  wrong: number;
  blank: number;
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
  /** v1.2: the candidate starts, navigates and submits on their own within timeMinutes. */
  selfPaced: boolean;
  /** v1.2: shuffle question order and choice order per session (fairness + leak resistance). */
  shuffle: boolean;
  /** v1.2: marking scheme for scoring 'auto'; null otherwise. */
  autoScoring: AutoScoring | null;
  /** v1.2: candidate instructions for this section; overrides Kit.candidateInstructions when set. */
  candidateInstructions: string | null;
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
  /** v1.2: multiple-choice options in canonical order (markdown). Null unless mode is 'mcq'. */
  choices: string[] | null;
  /** v1.2: index into `choices` of the correct option. NEVER sent to candidates. */
  correctChoice: number | null;
  /** v1.2: make-a-market template (mode 'market'); null otherwise. NEVER sent to candidates. */
  market: MarketConfig | null;
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

/** v1.3: 'cancelled' = the interviewer voided a session that never started; its link is dead (404). */
export type SessionStatus = 'ready' | 'live' | 'completed' | 'cancelled';

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
  /** v1.2: canonical index of the candidate's choice (mcq); null = blank. */
  choice: number | null;
  /** v1.2: points under section.autoScoring (auto sections); null for other sections. */
  autoScore: number | null;
  /** v1.2: AI-drafted note from the transcript + typed answer (local model). A draft, never a score. */
  aiDraftNote: string | null;
  aiDraftAt: string | null;
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
  /** May be fractional for auto sections with negative marking (e.g. 13.75). */
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
  /**
   * v1.1: when the section's time runs out = startedAt + section.timeMinutes + extensionMinutes.
   * Null before start or when the section has no time limit.
   */
  sectionEndsAt: string | null;
  /** v1.1: minutes the interviewer has added (extra time, tech trouble, adjustments). */
  extensionMinutes: number;
  /** v1.2: shuffled sections — question keys in the order this candidate sees them; else null. */
  questionOrder: string[] | null;
  /** v1.2: local transcription of the camera audio. */
  transcript: SessionTranscript;
  /** v1.2: make-a-market games (market sections only; null otherwise). */
  market: SessionMarket | null;
}

// ---- v1.2: make-a-market (live; interviewer-driven) ---------------------------------------
// The candidate keeps a two-sided quote (bid < ask, size) on the table. The interviewer buys at the
// ask or sells at the bid, reveals information (a die, a hint) and finally settles against the true
// value. P&L is from the CANDIDATE's side: they sold at the ask when the interviewer bought.

export interface MarketQuote {
  bid: number;
  ask: number;
  size: number;
  at: string;
  /** How many reveals had happened when this quote was made. */
  revealsSoFar: number;
}

export interface MarketTrade {
  /** Interviewer's side: 'buy' = lifted the candidate's ask; 'sell' = hit the candidate's bid. */
  side: 'buy' | 'sell';
  price: number;
  size: number;
  at: string;
}

export interface MarketMetrics {
  quotes: number;
  avgSpread: number;
  /** dice only: share of quotes whose [bid, ask] contained the fair value at the time. */
  fairInsideRate: number | null;
  /** dice only: mean |mid − fair value| across quotes. */
  meanMidError: number | null;
  /** Share of trades after which the next quote moved away from the side that was hit. */
  skewAfterTradeRate: number | null;
  /** Final P&L to the candidate, settled at the true value. */
  pnl: number;
  /** Largest absolute position the candidate carried. */
  maxAbsPosition: number;
}

export interface MarketGame {
  id: string;
  questionKey: string;
  kind: 'dice' | 'estimate';
  status: 'open' | 'settled';
  startedAt: string;
  settledAt: string | null;
  /** Revealed information, in order: dice values ("4") or hint texts. */
  reveals: string[];
  /** Reveals still available (dice left to reveal / hints left). */
  revealsRemaining: number;
  quote: MarketQuote | null;
  quotes: MarketQuote[];
  trades: MarketTrade[];
  /** Candidate's net position (+ = long). */
  position: number;
  /** INTERVIEWER ONLY: the true value (dice total rolled at start; estimate answer). */
  trueValue: number;
  /** dice only: expected value of the total given the reveals so far. */
  fairValue: number | null;
  /** Mark-to-true P&L so far (candidate's side). */
  pnl: number;
  /** Set when settled. */
  metrics: MarketMetrics | null;
}

export interface SessionMarket {
  games: MarketGame[];
  activeGameId: string | null;
}

// POST /api/sessions/:id/market/games                      body: StartMarketGame → Session  (live; one open game at a time)
// POST /api/sessions/:id/market/games/:gameId/trade        body: MarketTradeRequest → Session
//        409 {reason:'no_quote'} when the candidate has no quote on the table.
// POST /api/sessions/:id/market/games/:gameId/reveal                                → Session  (409 when none left)
// POST /api/sessions/:id/market/games/:gameId/settle                                → Session
// PUT  /api/candidate/:token/quote                         body: QuoteRequest → CandidateState
//        400 unless bid < ask, both finite, size integer 1–100; 409 when no open game.

export interface StartMarketGame {
  questionKey: string;
}

export interface MarketTradeRequest {
  side: 'buy' | 'sell';
  /** Defaults to the quote's size; must not exceed it. */
  size?: number;
}

export interface QuoteRequest {
  bid: number;
  ask: number;
  size: number;
}

/** v1.2: the candidate's own view of the active (or last settled) game. Allowlisted. */
export interface CandidateMarket {
  gameNumber: number;
  prompt: string;
  unit: string | null;
  reveals: string[];
  status: 'open' | 'settled';
  quote: { bid: number; ask: number; size: number } | null;
  /** From the candidate's side: 'you_sold' when the interviewer bought. */
  trades: { side: 'you_bought' | 'you_sold'; price: number; size: number; at: string }[];
  position: number;
  /** Only after settlement: the true value and the candidate's P&L. */
  settlement: { value: number; pnl: number } | null;
}

// ---- v1.2: transcription ------------------------------------------------------------------

export type TranscriptStatus = 'none' | 'pending' | 'processing' | 'done' | 'failed';

export interface TranscriptLine {
  /** Absolute times (segment start + offset). */
  at: string;
  end: string;
  text: string;
  /** The question presented at `at` (server-derived from firstPresentedAt order); null = intro. */
  questionKey: string | null;
}

export interface SessionTranscript {
  status: TranscriptStatus;
  /** e.g. "whisper.cpp large-v3-turbo" and the note model, e.g. "qwen3.5:122b". */
  model: string | null;
  noteModel: string | null;
  updatedAt: string | null;
  error: string | null;
  lines: TranscriptLine[];
}

// POST /api/sessions/:id/transcribe → Session   (queue or re-queue; 409 without camera recordings)
// Ended recorded sessions are queued automatically.
//
// INTERNAL — the host-side transcription worker only. Reached on 127.0.0.1:4310 (never through
// Cloudflare) with header `x-internal-token: $INTERNAL_API_TOKEN`; 401 otherwise.
// POST /api/internal/transcription/claim                 → TranscriptionJob, or 204 when idle
// GET  /api/internal/recordings/:segmentId/audio         → audio/wav, 16 kHz mono (ffmpeg)
// POST /api/internal/transcription/:sessionId/result     body: TranscriptionResult → 204
// POST /api/internal/transcription/:sessionId/fail       body: { error: string }   → 204

export interface TranscriptionJob {
  sessionId: string;
  /** Camera segments (they carry the audio), oldest first. */
  segments: { id: string; startedAt: string; endedAt: string | null }[];
  questions: {
    key: string;
    title: string;
    prompt: string;
    modelAnswer: string | null;
    rubric: Rubric | null;
    whatGoodLooksLike: string | null;
    candidateAnswer: string | null;
    /** When the question was on screen: [firstPresentedAt, next question's firstPresentedAt or end). */
    from: string | null;
    to: string | null;
  }[];
}

export interface TranscriptionResult {
  model: string;
  noteModel: string;
  lines: { at: string; end: string; text: string }[];
  notes: { questionKey: string; text: string }[];
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
// POST  /api/sessions/:id/extend                  body: ExtendSession   → Session   (v1.1; ready or live)
// POST  /api/sessions/:id/cancel                                        → Session   (v1.3; ready → cancelled,
//                                                   409 otherwise). Every candidate endpoint then answers 404
//                                                   for its token, exactly like an unknown token.
// v1.2: /start and /present return 409 {reason:'self_paced'} for self-paced sections — the candidate drives.
// GET   /api/sessions/:id/recordings/:segmentId   → the media file (Content-Type = segment mimeType),
//                                                   HTTP Range supported for seeking. PROTECTED.

export interface CreateSession {
  candidateId: string;
  section: SectionKey;
  /** v1. Default: section.candidateView. False = no consent/recording (e.g. an adjustment). */
  recordingRequired?: boolean;
}

/** v1.1 */
export interface ExtendSession {
  /** Integer 1–60. Bumps the candidate version so their countdown updates. */
  minutes: number;
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
//        v1.1: 409 {reason: 'time_up'} once serverNow > sectionEndsAt + 15 s.
// POST /api/candidate/:token/recordings            body: StartRecording  → StartedRecording
//        409 unless consent was given; allowed while the session is ready or live.
// PUT  /api/candidate/:token/recordings/:segmentId/chunks/:seq   raw bytes → ChunkAck
//        seq starts at 0 and is contiguous: seq < next → 200 no-op (duplicate), seq > next → 409.
//        Max 8 MB per chunk, 6 GB per session.
// POST /api/candidate/:token/recordings/:segmentId/stop                  → 204
// POST /api/candidate/:token/events                body: CandidateEvents → 204   (max 50 per call)
// v1.2 — self-paced sections:
// POST /api/candidate/:token/start                                       → CandidateState
//        ready → live; 409 consent_required / devices_required (a camera AND a screen segment must
//        have started) when recording is required.
// POST /api/candidate/:token/navigate              body: Navigate        → CandidateState
// POST /api/candidate/:token/submit                                      → CandidateState  (→ completed)
//        Self-paced sessions are completed automatically ~60 s after sectionEndsAt.
// v1.2 — multiple choice (self-paced: any position; live: presented now or earlier):
// PUT  /api/candidate/:token/choice                body: SaveChoice      → SavedAnswer
//        409 time_up after sectionEndsAt + 15 s; 409 not_live.

export interface Navigate {
  /** Displayed position, 1-based. */
  position: number;
}

export interface SaveChoice {
  /** Displayed position, 1-based. */
  position: number;
  /** Displayed option index, 0-based; null clears the answer (a blank scores autoScoring.blank). */
  choice: number | null;
}

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
  /** v1.2: displayed index of the selected option; null = none (or not multiple choice). */
  choice: number | null;
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
  /** v1.2: options in THIS candidate's display order (markdown); null unless multiple choice. */
  choices: string[] | null;
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
  /** v1.1: section countdown target (same as Session.sectionEndsAt). Answers lock after it. */
  sectionEndsAt: string | null;
  /** v1.2: the candidate drives start/navigation/submit. */
  selfPaced: boolean;
  /** v1.2: displayed positions the candidate has answered (their own data, for the navigator). */
  answeredPositions: number[];
  /** v1.2: the marking scheme, shown to the candidate up front; null for non-auto sections. */
  marking: AutoScoring | null;
  /** v1.2: market sections — the active or last settled game; null otherwise. */
  market: CandidateMarket | null;
}

// GET /api/health → { ok: true }   (unauthenticated)
