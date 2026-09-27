/**
 * In-memory implementation of ApiClient for `VITE_MOCK=1`, seeded from kit/fixtures/sample.seed.json.
 * The store lives in localStorage so a candidate tab follows the console tab. Loaded by dynamic
 * import only; never part of the production bundle.
 *
 * v1: consent, answers, integrity events and recording segments are implemented with the same
 * rules as the API (position checks, contiguous chunk sequence, time-up lock). Chunk bytes are
 * counted, never stored.
 */
import type {
  Band,
  CandidateDetail,
  CandidateState,
  CandidateSummary,
  DimensionRating,
  IntegrityEvent,
  Kit,
  Question,
  RecordingSegment,
  ResponseRecord,
  SectionDef,
  Session,
  SessionSummary,
  Verdict,
} from '@contracts/api';
import type { KitSeed } from '@contracts/kit-seed';
import { ApiError, type ApiClient } from './client';

const KEY = 'talent-os-mock-v1';

const CONSENT_TEXT =
  'This written test is recorded. With your agreement, your camera, microphone and your entire screen will be recorded from now until the interviewer ends the session, and uploaded as you go. The recording is used only to assess this test, is seen only by the hiring team, and is deleted 90 days after a hiring decision. You can stop at any time by closing this tab.';

const FLAG_TYPES = new Set(['tab_hidden', 'window_blur', 'paste', 'screen_share_stopped', 'camera_stopped']);

interface CandidateRow {
  id: string;
  applicationId: string;
  name: string;
  email: string | null;
  source: string | null;
  notes: string | null;
  overallDecision: string | null;
  decisionAt: string | null;
  level: string | null;
  compNote: string | null;
  createdAt: string;
}

interface SessionRow {
  id: string;
  token: string;
  version: number;
  candidateId: string;
  section: string;
  kitId: string;
  kitVersion: string;
  status: Session['status'];
  interviewer: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  presentedQuestionKey: string | null;
  presentedAt: string | null;
  setNotes: string;
  recommendation: string | null;
  responses: ResponseRecord[];
  ratings: DimensionRating[];
  recordingRequired: boolean;
  consentAt: string | null;
  segments: RecordingSegment[];
  events: IntegrityEvent[];
  extensionMinutes: number;
  /** v1.2: shuffled question keys in display order; null = canonical order. */
  questionOrder: string[] | null;
  /** v1.2: per question key, canonical choice index at each displayed index; null = canonical. */
  choiceOrders: Record<string, number[]> | null;
  /** v1.2: self-paced — the displayed position the candidate is on (1-based). */
  currentPosition: number;
}

interface Store {
  orgName: string;
  kit: Kit;
  candidates: CandidateRow[];
  sessions: SessionRow[];
  seq: number;
}

const ME = { email: 'interviewer@example.com' };

/** v1.2: a synthetic self-paced multiple-choice section (MOCK ONLY — never a real kit). */
const MCQ_SECTION: Omit<SectionDef, 'questionKeys'> = {
  key: 'M',
  stage: 0,
  label: 'Stage 0 — Multiple-choice screen',
  candidateLabel: 'Online test',
  scoring: 'auto',
  timeMinutes: 10,
  maxScore: 4,
  bands: [{ min: 2, label: 'Pass — progress' }],
  dimensionIds: [],
  recommendationOptions: [],
  domainGroups: [
    { domain: 'math', label: 'Math' },
    { domain: 'probability', label: 'Probability' },
    { domain: 'statistics', label: 'Statistics' },
  ],
  candidateView: true,
  showInstructions: true,
  interviewerNotes: 'Candidate-paced: the candidate starts, navigates and submits on their own. Auto-scored: +1 correct, −¼ wrong, 0 blank.',
  selfPaced: true,
  shuffle: true,
  autoScoring: { correct: 1, wrong: -0.25, blank: 0 },
  candidateInstructions:
    'You have **10 minutes** for 4 multiple-choice questions. Pick one option per question; you can change or clear an answer and move between questions freely. Wrong answers lose a quarter of a mark, blanks score zero — so only guess when you can rule options out. Press **Submit test** when you are done.',
};
const mcqQ = (n: number, domain: Question['domain'], title: string, prompt: string, choices: string[], correctChoice: number, modelAnswer: string): Omit<Question, 'id'> => ({
  key: `M${n}`,
  section: 'M',
  stage: 0,
  number: n,
  title,
  domain,
  difficulty: 'easy',
  mode: 'mcq',
  timeMinutes: null,
  prompt,
  dataset: null,
  code: null,
  modelAnswer,
  rubric: null,
  trapOrBonus: null,
  whatGoodLooksLike: null,
  choices,
  correctChoice,
  market: null,
});
const MCQ_QUESTIONS: Omit<Question, 'id'>[] = [
  mcqQ(1, 'math', 'Derivative of a cube', 'What is the derivative of $x^3$ evaluated at $x = 2$?', ['6', '12', '8', '4'], 1, 'd/dx x³ = 3x², which is 12 at x = 2.'),
  mcqQ(2, 'probability', 'Sum of two dice', 'Two fair six-sided dice are rolled. What is the probability that the sum is 7?', ['1/12', '1/6', '1/9', '5/36'], 1, 'Six of the 36 equally likely outcomes sum to 7: 6/36 = 1/6.'),
  mcqQ(3, 'statistics', 'Sample mean', 'A sample has the values 2, 4, 4, 4, 5, 5, 7, 9. What is the sample mean?', ['4', '4.5', '5', '5.5'], 2, 'The values sum to 40 over 8 observations: 40/8 = 5.'),
  mcqQ(4, 'math', 'Base-2 logarithm', 'What is $\\log_2 64$?', ['5', '6', '7', '8'], 1, '2⁶ = 64, so log₂ 64 = 6.'),
];

function buildKit(seed: KitSeed): Kit {
  const questions: Question[] = [...seed.questions, ...MCQ_QUESTIONS].map((q, i) => ({
    ...q,
    id: `q${i + 1}`,
    choices: q.choices ?? null,
    correctChoice: q.correctChoice ?? null,
    market: q.market ?? null,
  }));
  const sections: SectionDef[] = [...seed.sections, MCQ_SECTION].map((s) => ({
    ...s,
    selfPaced: s.selfPaced ?? false,
    shuffle: s.shuffle ?? false,
    autoScoring: s.autoScoring ?? null,
    candidateInstructions: s.candidateInstructions ?? null,
    questionKeys: questions
      .filter((q) => q.section === s.key)
      .sort((a, b) => a.number - b.number)
      .map((q) => q.key),
  }));
  return {
    id: 'kit1',
    slug: seed.slug,
    title: seed.title,
    version: seed.version,
    jobTitle: seed.job.title,
    candidateInstructions: seed.candidateInstructions,
    dimensions: seed.dimensions,
    sections,
    questions,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function load(seed: KitSeed): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && s.kit && s.candidates && s.sessions) {
        // Stores written before v1.2 lack the synthetic mcq section.
        if (!s.kit.sections.some((x) => x.scoring === 'auto')) s.kit = buildKit(seed);
        // Rows written by the v0 mock lack the v1 fields.
        for (const row of s.sessions) {
          row.recordingRequired ??= false;
          row.consentAt ??= null;
          row.segments ??= [];
          row.events ??= [];
          row.extensionMinutes ??= 0;
          row.questionOrder ??= null;
          row.choiceOrders ??= null;
          row.currentPosition ??= 1;
          for (const r of row.responses) {
            r.candidateAnswer ??= null;
            r.candidateAnswerAt ??= null;
            r.firstPresentedAt ??= null;
            r.choice ??= null;
            r.autoScore ??= null;
            r.aiDraftNote ??= null;
            r.aiDraftAt ??= null;
          }
        }
        for (const c of s.candidates) c.decisionAt ??= null;
        return s;
      }
    }
  } catch {
    /* fall through */
  }
  return { orgName: seed.orgName, kit: buildKit(seed), candidates: [], sessions: [], seq: 1 };
}

function save(s: Store) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function computeVerdict(kit: Kit, section: SectionDef, responses: ResponseRecord[], status: Session['status'] = 'live'): Verdict | null {
  const qs = section.questionKeys.map((k) => kit.questions.find((q) => q.key === k)).filter((q): q is Question => !!q);
  const byKey = new Map(responses.map((r) => [r.questionKey, r]));
  if (section.scoring === 'auto') {
    // v1.2: negative marking — the total may be fractional; complete once the candidate submitted.
    const marking = section.autoScoring ?? { correct: 1, wrong: 0, blank: 0 };
    const pts = (q: Question) => byKey.get(q.key)?.autoScore ?? 0;
    const total = round2(qs.reduce((acc, q) => acc + pts(q), 0));
    const answered = qs.filter((q) => (byKey.get(q.key)?.choice ?? null) !== null).length;
    const subtotals = section.domainGroups.map((g) => {
      const gq = qs.filter((q) => q.domain === g.domain);
      return { domain: g.domain, label: g.label, total: round2(gq.reduce((acc, q) => acc + pts(q), 0)), max: gq.length * marking.correct };
    });
    const bands = [...section.bands].sort((a, b) => a.min - b.min);
    let band: Band | null = null;
    for (const b of bands) if (total >= b.min) band = b;
    return {
      total,
      max: section.maxScore ?? qs.length * marking.correct,
      scored: answered,
      skipped: status === 'completed' ? qs.length - answered : 0,
      complete: status === 'completed',
      subtotals,
      band,
      result: band ? band.label : 'Below threshold',
    };
  }
  if (section.scoring !== 'rubric') return null;
  let total = 0;
  let scored = 0;
  let skipped = 0;
  for (const q of qs) {
    const r = byKey.get(q.key);
    if (r && r.score !== null) {
      total += r.score;
      scored += 1;
    } else if (r && r.skipped) {
      skipped += 1;
    }
  }
  const max = section.maxScore ?? qs.length * 3;
  const subtotals = section.domainGroups.map((g) => {
    const gq = qs.filter((q) => q.domain === g.domain);
    const t = gq.reduce((acc, q) => {
      const r = byKey.get(q.key);
      return acc + (r && r.score !== null ? r.score : 0);
    }, 0);
    return { domain: g.domain, label: g.label, total: t, max: gq.length * 3 };
  });
  const bands = [...section.bands].sort((a, b) => a.min - b.min);
  let band: Band | null = null;
  for (const b of bands) if (total >= b.min) band = b;
  return {
    total,
    max,
    scored,
    skipped,
    complete: qs.length > 0 && scored + skipped === qs.length,
    subtotals,
    band,
    result: band ? band.label : 'Below threshold',
  };
}

export async function createMockClient(): Promise<ApiClient> {
  const seedModule = await import('../../../kit/fixtures/sample.seed.json');
  const seed = (seedModule.default ?? seedModule) as unknown as KitSeed;

  let store = load(seed);
  save(store);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) store = load(seed);
  });

  const fresh = () => {
    store = load(seed);
    autoComplete();
    return store;
  };

  /** v1.2: self-paced sessions complete on their own ~60 s after the section time runs out. */
  const autoComplete = () => {
    let changed = false;
    for (const row of store.sessions) {
      if (row.status !== 'live') continue;
      const sec = store.kit.sections.find((x) => x.key === row.section);
      if (!sec?.selfPaced) continue;
      const ends = sectionEndsAt(row);
      if (ends && Date.now() > Date.parse(ends) + 60_000) {
        finishSession(row);
        changed = true;
      }
    }
    if (changed) save(store);
  };

  const finishSession = (row: SessionRow) => {
    accountTime(row);
    row.status = 'completed';
    row.endedAt = nowIso();
    row.presentedQuestionKey = null;
    row.presentedAt = null;
    row.version += 1;
  };

  // v1.2: display order helpers (shuffled sections map displayed positions/options to canonical ones).
  const orderOf = (row: SessionRow, sec: SectionDef) => row.questionOrder ?? sec.questionKeys;
  const keyAt = (row: SessionRow, sec: SectionDef, position: number): string | undefined => orderOf(row, sec)[position - 1];
  const displayChoices = (row: SessionRow, q: Question): string[] | null => {
    if (!q.choices) return null;
    const order = row.choiceOrders?.[q.key];
    return order ? order.map((i) => q.choices![i]) : q.choices;
  };
  const toDisplayIdx = (row: SessionRow, q: Question, canonical: number | null): number | null => {
    if (canonical === null) return null;
    const order = row.choiceOrders?.[q.key];
    return order ? order.indexOf(canonical) : canonical;
  };
  const toCanonicalIdx = (row: SessionRow, q: Question, display: number): number => {
    const order = row.choiceOrders?.[q.key];
    return order ? order[display] : display;
  };
  const shuffled = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const nextId = (prefix: string) => {
    store.seq += 1;
    return `${prefix}${store.seq}`;
  };

  const section = (key: string) => {
    const s = store.kit.sections.find((x) => x.key === key);
    if (!s) throw new ApiError(400, `Unknown section ${key}`);
    return s;
  };

  const candidateRow = (id: string) => {
    const c = store.candidates.find((x) => x.id === id);
    if (!c) throw new ApiError(404, 'Candidate not found');
    return c;
  };

  const sessionRow = (id: string) => {
    const s = store.sessions.find((x) => x.id === id);
    if (!s) throw new ApiError(404, 'Session not found');
    return s;
  };

  const sessionByToken = (token: string) => {
    const row = store.sessions.find((s) => s.token === token);
    if (!row) throw new ApiError(404, 'Not found');
    if (!section(row.section).candidateView) throw new ApiError(404, 'Not found');
    return row;
  };

  const sectionEndsAt = (row: SessionRow): string | null => {
    const sec = section(row.section);
    if (!row.startedAt || sec.timeMinutes === null) return null;
    return new Date(Date.parse(row.startedAt) + (sec.timeMinutes + row.extensionMinutes) * 60_000).toISOString();
  };

  const toSession = (row: SessionRow): Session => {
    const sec = section(row.section);
    const cand = store.candidates.find((c) => c.id === row.candidateId);
    return clone({
      id: row.id,
      candidateId: row.candidateId,
      candidateName: cand?.name ?? '?',
      section: row.section,
      kitId: row.kitId,
      kitVersion: row.kitVersion,
      status: row.status,
      interviewer: row.interviewer,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      presentedQuestionKey: row.presentedQuestionKey,
      presentedAt: row.presentedAt,
      candidateUrl: sec.candidateView ? `${window.location.origin}/c/${row.token}` : null,
      setNotes: row.setNotes,
      recommendation: row.recommendation,
      responses: row.responses,
      ratings: row.ratings,
      verdict: computeVerdict(store.kit, sec, row.responses, row.status),
      serverNow: nowIso(),
      recording: { required: row.recordingRequired, consentAt: row.consentAt, segments: row.segments },
      events: row.events,
      sectionEndsAt: sectionEndsAt(row),
      extensionMinutes: row.extensionMinutes,
      questionOrder: row.questionOrder,
      transcript: { status: 'none', model: null, noteModel: null, updatedAt: null, error: null, lines: [] },
      market: null,
    });
  };

  const isSuperseded = (row: SessionRow) =>
    store.sessions.some((o) => o.candidateId === row.candidateId && o.section === row.section && o.createdAt > row.createdAt);

  const toSummary = (row: SessionRow): SessionSummary => ({
    id: row.id,
    section: row.section,
    status: row.status,
    interviewer: row.interviewer,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    verdict: computeVerdict(store.kit, section(row.section), row.responses, row.status),
    ratings: clone(row.ratings),
    recommendation: row.recommendation,
    trapsNoticed: row.responses.filter((r) => r.trapNoticed).length,
    bonusesGiven: row.responses.filter((r) => r.bonusGiven).length,
    superseded: isSuperseded(row),
    recorded: row.segments.length > 0,
    integrityFlags: row.events.filter((e) => FLAG_TYPES.has(e.type)).length,
  });

  const toCandidateSummary = (c: CandidateRow): CandidateSummary => {
    const rows = store.sessions.filter((s) => s.candidateId === c.id);
    const latest: Record<string, SessionSummary> = {};
    let stageReached = 0;
    for (const r of rows) {
      const sec = section(r.section);
      stageReached = Math.max(stageReached, sec.stage);
      if (!isSuperseded(r)) latest[r.section] = toSummary(r);
    }
    return {
      id: c.id,
      applicationId: c.applicationId,
      name: c.name,
      email: c.email,
      source: c.source,
      createdAt: c.createdAt,
      stageReached,
      latest,
      overallDecision: c.overallDecision,
    };
  };

  const toCandidateDetail = (c: CandidateRow): CandidateDetail => ({
    ...toCandidateSummary(c),
    notes: c.notes,
    level: c.level,
    compNote: c.compNote,
    decisionAt: c.decisionAt,
    sessions: store.sessions
      .filter((s) => s.candidateId === c.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(toSummary),
  });

  const upsertResponse = (row: SessionRow, key: string, patch: Partial<ResponseRecord>) => {
    let r = row.responses.find((x) => x.questionKey === key);
    if (!r) {
      r = {
        questionKey: key,
        score: null,
        notes: '',
        trapNoticed: false,
        bonusGiven: false,
        skipped: false,
        markedForReturn: false,
        timeSpentSeconds: 0,
        updatedAt: nowIso(),
        candidateAnswer: null,
        candidateAnswerAt: null,
        firstPresentedAt: null,
        choice: null,
        autoScore: null,
        aiDraftNote: null,
        aiDraftAt: null,
      };
      row.responses.push(r);
    }
    Object.assign(r, patch, { updatedAt: nowIso() });
    return r;
  };

  /** Close the time account of the currently presented question. */
  const accountTime = (row: SessionRow) => {
    if (row.presentedQuestionKey && row.presentedAt) {
      const elapsed = Math.max(0, Math.round((Date.now() - Date.parse(row.presentedAt)) / 1000));
      const r = upsertResponse(row, row.presentedQuestionKey, {});
      r.timeSpentSeconds += elapsed;
    }
  };

  const commit = (row?: SessionRow) => {
    if (row) row.version += 1;
    save(store);
  };

  const segmentOf = (row: SessionRow, segmentId: string) => {
    const seg = row.segments.find((s) => s.id === segmentId);
    if (!seg) throw new ApiError(404, 'Segment not found');
    return seg;
  };

  const delay = () => new Promise((r) => setTimeout(r, 30));

  const client: ApiClient = {
    async getKit() {
      await delay();
      return clone(fresh().kit);
    },
    async putSectionBands(key, bands) {
      await delay();
      fresh();
      const sec = section(key);
      sec.bands = [...bands].sort((a, b) => a.min - b.min);
      commit();
      return clone(store.kit);
    },
    async getMe() {
      await delay();
      return { email: ME.email, org: { id: 'org1', name: fresh().orgName } };
    },
    async createSession(body) {
      await delay();
      fresh();
      candidateRow(body.candidateId);
      const sec = section(body.section);
      const id = nextId('s');
      const row: SessionRow = {
        id,
        token: `tok-${id}-${Math.random().toString(36).slice(2, 10)}`,
        version: 1,
        candidateId: body.candidateId,
        section: body.section,
        kitId: store.kit.id,
        kitVersion: store.kit.version,
        status: 'ready',
        interviewer: ME.email,
        createdAt: nowIso(),
        startedAt: null,
        endedAt: null,
        presentedQuestionKey: null,
        presentedAt: null,
        setNotes: '',
        recommendation: null,
        responses: [],
        ratings: [],
        recordingRequired: body.recordingRequired ?? sec.candidateView,
        consentAt: null,
        segments: [],
        events: [],
        extensionMinutes: 0,
        questionOrder: null,
        choiceOrders: null,
        currentPosition: 1,
      };
      if (sec.shuffle) {
        row.questionOrder = shuffled(sec.questionKeys);
        row.choiceOrders = {};
        for (const k of sec.questionKeys) {
          const q = store.kit.questions.find((x) => x.key === k);
          if (q?.choices) row.choiceOrders[k] = shuffled(q.choices.map((_, i) => i));
        }
      }
      store.sessions.push(row);
      commit();
      return toSession(row);
    },
    async getSession(id) {
      await delay();
      fresh();
      return toSession(sessionRow(id));
    },
    async startSession(id) {
      await delay();
      fresh();
      const row = sessionRow(id);
      if (section(row.section).selfPaced) throw new ApiError(409, 'The candidate starts this section', { reason: 'self_paced' });
      if (row.status !== 'ready') throw new ApiError(409, 'Session is not ready');
      row.status = 'live';
      row.startedAt = nowIso();
      commit(row);
      return toSession(row);
    },
    async presentQuestion(id, body) {
      await delay();
      fresh();
      const row = sessionRow(id);
      if (section(row.section).selfPaced) throw new ApiError(409, 'The candidate navigates this section', { reason: 'self_paced' });
      if (row.status !== 'live') throw new ApiError(409, 'Session is not live');
      if (body.questionKey !== null && !section(row.section).questionKeys.includes(body.questionKey))
        throw new ApiError(400, 'Question is not in this section');
      accountTime(row);
      row.presentedQuestionKey = body.questionKey;
      row.presentedAt = body.questionKey === null ? null : nowIso();
      if (body.questionKey !== null) {
        const r = upsertResponse(row, body.questionKey, {});
        if (!r.firstPresentedAt) r.firstPresentedAt = row.presentedAt;
      }
      commit(row);
      return toSession(row);
    },
    async updateResponse(id, key, body) {
      await delay();
      fresh();
      const row = sessionRow(id);
      if (!section(row.section).questionKeys.includes(key)) throw new ApiError(400, 'Question is not in this section');
      upsertResponse(row, key, body as Partial<ResponseRecord>);
      commit();
      return toSession(row);
    },
    async updateRating(id, dimensionId, body) {
      await delay();
      fresh();
      const row = sessionRow(id);
      let r = row.ratings.find((x) => x.dimensionId === dimensionId);
      if (!r) {
        r = { dimensionId, rating: null, note: '' };
        row.ratings.push(r);
      }
      Object.assign(r, body);
      commit();
      return toSession(row);
    },
    async updateSession(id, body) {
      await delay();
      fresh();
      const row = sessionRow(id);
      Object.assign(row, body);
      commit();
      return toSession(row);
    },
    async endSession(id) {
      await delay();
      fresh();
      const row = sessionRow(id);
      if (row.status === 'completed') throw new ApiError(409, 'Session already completed');
      finishSession(row);
      commit();
      return toSession(row);
    },
    async reopenSession(id) {
      await delay();
      fresh();
      const row = sessionRow(id);
      if (row.status !== 'completed') throw new ApiError(409, 'Session is not completed');
      row.status = 'live';
      row.endedAt = null;
      commit(row);
      return toSession(row);
    },
    async extendSession(id, body) {
      await delay();
      fresh();
      const row = sessionRow(id);
      if (row.status === 'completed') throw new ApiError(409, 'Session is completed');
      if (!Number.isInteger(body.minutes) || body.minutes < 1 || body.minutes > 60) throw new ApiError(400, 'minutes must be an integer 1–60');
      row.extensionMinutes += body.minutes;
      commit(row);
      return toSession(row);
    },
    async listCandidates() {
      await delay();
      fresh();
      return [...store.candidates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(toCandidateSummary);
    },
    async createCandidate(body) {
      await delay();
      fresh();
      if (!body.name?.trim()) throw new ApiError(400, 'name is required');
      const id = nextId('c');
      const row: CandidateRow = {
        id,
        applicationId: `app-${id}`,
        name: body.name.trim(),
        email: body.email?.trim() || null,
        source: body.source?.trim() || null,
        notes: body.notes?.trim() || null,
        overallDecision: null,
        decisionAt: null,
        level: null,
        compNote: null,
        createdAt: nowIso(),
      };
      store.candidates.push(row);
      commit();
      return toCandidateDetail(row);
    },
    async getCandidate(id) {
      await delay();
      fresh();
      return toCandidateDetail(candidateRow(id));
    },
    async updateCandidate(id, body) {
      await delay();
      fresh();
      const row = candidateRow(id);
      if ('overallDecision' in body && body.overallDecision !== row.overallDecision) row.decisionAt = body.overallDecision ? nowIso() : null;
      Object.assign(row, body);
      commit();
      return toCandidateDetail(row);
    },
    async getCandidateState(token) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      const sec = section(row.section);
      const order = orderOf(row, sec);
      const answeredPositions = order
        .map((k, i) => ((row.responses.find((x) => x.questionKey === k)?.choice ?? null) !== null ? i + 1 : 0))
        .filter((p) => p > 0);
      const instructions = sec.candidateInstructions ?? (sec.showInstructions ? store.kit.candidateInstructions : null);
      const base = {
        orgName: store.orgName,
        sectionLabel: sec.candidateLabel,
        serverNow: nowIso(),
        version: row.version,
        recording: {
          required: row.recordingRequired,
          consentGiven: row.consentAt !== null,
          consentText: row.recordingRequired ? CONSENT_TEXT : null,
        },
        answer: null,
        sectionEndsAt: sectionEndsAt(row),
        selfPaced: sec.selfPaced,
        answeredPositions,
        marking: sec.scoring === 'auto' ? sec.autoScoring : null,
        market: null,
      };
      if (row.status === 'ready') {
        // v1.2: self-paced sections show the intro card (with Start) before the candidate begins.
        if (sec.selfPaced) return { ...base, phase: 'intro', instructions, question: null, presentedAt: null };
        return { ...base, phase: 'waiting', instructions: null, question: null, presentedAt: null };
      }
      if (row.status === 'completed') {
        return { ...base, phase: 'ended', instructions: null, question: null, presentedAt: null };
      }
      const currentKey = sec.selfPaced ? keyAt(row, sec, row.currentPosition) ?? null : row.presentedQuestionKey;
      if (currentKey === null) {
        return { ...base, phase: 'intro', instructions, question: null, presentedAt: null };
      }
      const q = store.kit.questions.find((x) => x.key === currentKey);
      if (!q) throw new ApiError(404, 'Not found');
      const r = row.responses.find((x) => x.questionKey === q.key);
      const state: CandidateState = {
        ...base,
        phase: 'question',
        instructions: null,
        question: {
          position: order.indexOf(q.key) + 1,
          total: order.length,
          prompt: q.prompt,
          dataset: q.dataset,
          code: q.code,
          timeMinutes: sec.selfPaced ? null : q.timeMinutes,
          choices: displayChoices(row, q),
        },
        presentedAt: sec.selfPaced ? null : row.presentedAt,
        answer: { text: r?.candidateAnswer ?? '', savedAt: r?.candidateAnswerAt ?? null, choice: toDisplayIdx(row, q, r?.choice ?? null) },
      };
      return state;
    },
    async postConsent(token) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      if (!row.recordingRequired) throw new ApiError(409, 'Recording is not required for this session');
      if (!row.consentAt) {
        row.consentAt = nowIso();
        row.events.push({ type: 'consent_given', at: row.consentAt, clientAt: row.consentAt, questionKey: row.presentedQuestionKey, detail: null });
        commit(row);
      }
      return client.getCandidateState(token);
    },
    async saveAnswer(token, body) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      if (row.status !== 'live') throw new ApiError(409, 'Session is not live');
      const sec = section(row.section);
      const key = keyAt(row, sec, body.position);
      if (!key) throw new ApiError(400, 'Unknown position');
      if (typeof body.text !== 'string' || body.text.length > 20_000) throw new ApiError(400, 'text must be at most 20,000 characters');
      const r = row.responses.find((x) => x.questionKey === key);
      const presentedNow = row.presentedQuestionKey === key;
      if (!presentedNow && !r?.firstPresentedAt) throw new ApiError(409, 'Question has not been presented');
      const ends = sectionEndsAt(row);
      if (ends && Date.now() > Date.parse(ends) + 15_000) throw new ApiError(409, "Time's up", { reason: 'time_up' });
      const savedAt = nowIso();
      upsertResponse(row, key, { candidateAnswer: body.text, candidateAnswerAt: savedAt });
      commit();
      return { savedAt };
    },
    async startRecording(token, body) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      if (!row.consentAt) throw new ApiError(409, 'Consent has not been given');
      if (row.status === 'completed') throw new ApiError(409, 'Session is completed');
      if (!/^video\/(webm|mp4)/.test(body.mimeType)) throw new ApiError(400, 'Unsupported mimeType');
      if (body.stream !== 'camera' && body.stream !== 'screen') throw new ApiError(400, 'Unknown stream');
      const seg: RecordingSegment = {
        id: nextId('seg'),
        stream: body.stream,
        mimeType: body.mimeType,
        startedAt: nowIso(),
        endedAt: null,
        lastChunkAt: null,
        bytes: 0,
        chunks: 0,
      };
      row.segments.push(seg);
      commit();
      return { segmentId: seg.id };
    },
    async putChunk(token, segmentId, seq, blob) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      const seg = segmentOf(row, segmentId);
      if (blob.size > 8 * 1024 * 1024) throw new ApiError(413, 'Chunk too large');
      if (seq < seg.chunks) return { received: seg.chunks };
      if (seq > seg.chunks) throw new ApiError(409, 'Chunk out of order', { expected: seg.chunks });
      seg.chunks += 1;
      seg.bytes += blob.size;
      seg.lastChunkAt = nowIso();
      commit();
      return { received: seg.chunks };
    },
    async stopRecording(token, segmentId) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      const seg = segmentOf(row, segmentId);
      if (!seg.endedAt) seg.endedAt = nowIso();
      commit();
    },
    async postEvents(token, body) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      if (!Array.isArray(body.events) || body.events.length > 50) throw new ApiError(400, 'events: max 50 per call');
      const at = nowIso();
      for (const e of body.events) {
        row.events.push({
          type: e.type,
          at,
          clientAt: e.clientAt ?? null,
          questionKey: row.presentedQuestionKey,
          detail: e.detail ? String(e.detail).slice(0, 80) : null,
        });
      }
      commit();
    },
    // ---- v1.2: self-paced + multiple choice ------------------------------------------------
    async startTest(token) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      const sec = section(row.section);
      if (!sec.selfPaced) throw new ApiError(409, 'Your interviewer starts this section', { reason: 'not_self_paced' });
      if (row.status === 'live') return client.getCandidateState(token);
      if (row.status !== 'ready') throw new ApiError(409, 'Session is not ready', { reason: 'not_ready' });
      if (row.recordingRequired) {
        if (!row.consentAt) throw new ApiError(409, 'Consent has not been given', { reason: 'consent_required' });
        const has = (stream: string) => row.segments.some((s) => s.stream === stream);
        if (!has('camera') || !has('screen')) throw new ApiError(409, 'Camera and screen recording must be running', { reason: 'devices_required' });
      }
      row.status = 'live';
      row.startedAt = nowIso();
      row.currentPosition = 1;
      const key = keyAt(row, sec, 1) ?? null;
      row.presentedQuestionKey = key;
      row.presentedAt = key ? row.startedAt : null;
      if (key) {
        const r = upsertResponse(row, key, {});
        if (!r.firstPresentedAt) r.firstPresentedAt = row.startedAt;
      }
      commit(row);
      return client.getCandidateState(token);
    },
    async navigate(token, body) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      const sec = section(row.section);
      if (!sec.selfPaced) throw new ApiError(409, 'Not a self-paced section', { reason: 'not_self_paced' });
      if (row.status !== 'live') throw new ApiError(409, 'Session is not live', { reason: 'not_live' });
      const key = keyAt(row, sec, body.position);
      if (!Number.isInteger(body.position) || !key) throw new ApiError(400, 'Unknown position');
      accountTime(row);
      row.currentPosition = body.position;
      row.presentedQuestionKey = key;
      row.presentedAt = nowIso();
      const r = upsertResponse(row, key, {});
      if (!r.firstPresentedAt) r.firstPresentedAt = row.presentedAt;
      commit(row);
      return client.getCandidateState(token);
    },
    async submitTest(token) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      const sec = section(row.section);
      if (!sec.selfPaced) throw new ApiError(409, 'Not a self-paced section', { reason: 'not_self_paced' });
      if (row.status === 'completed') return client.getCandidateState(token);
      if (row.status !== 'live') throw new ApiError(409, 'Session is not live', { reason: 'not_live' });
      finishSession(row);
      commit();
      return client.getCandidateState(token);
    },
    async saveChoice(token, body) {
      await delay();
      fresh();
      const row = sessionByToken(token);
      if (row.status !== 'live') throw new ApiError(409, 'Session is not live', { reason: 'not_live' });
      const sec = section(row.section);
      const key = keyAt(row, sec, body.position);
      const q = key ? store.kit.questions.find((x) => x.key === key) : undefined;
      if (!key || !q) throw new ApiError(400, 'Unknown position');
      if (!q.choices) throw new ApiError(400, 'Not a multiple-choice question');
      if (body.choice !== null && (!Number.isInteger(body.choice) || body.choice < 0 || body.choice >= q.choices.length)) throw new ApiError(400, 'Unknown choice');
      const r = row.responses.find((x) => x.questionKey === key);
      if (!sec.selfPaced && row.presentedQuestionKey !== key && !r?.firstPresentedAt) throw new ApiError(409, 'Question has not been presented', { reason: 'not_presented' });
      const ends = sectionEndsAt(row);
      if (ends && Date.now() > Date.parse(ends) + 15_000) throw new ApiError(409, "Time's up", { reason: 'time_up' });
      const marking = sec.autoScoring ?? { correct: 1, wrong: 0, blank: 0 };
      const canonical = body.choice === null ? null : toCanonicalIdx(row, q, body.choice);
      const autoScore = sec.scoring !== 'auto' ? null : canonical === null ? marking.blank : canonical === q.correctChoice ? marking.correct : marking.wrong;
      const savedAt = nowIso();
      upsertResponse(row, key, { choice: canonical, autoScore, candidateAnswerAt: savedAt });
      commit(row);
      return { savedAt };
    },
  };
  return client;
}
