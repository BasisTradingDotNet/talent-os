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
}

interface Store {
  orgName: string;
  kit: Kit;
  candidates: CandidateRow[];
  sessions: SessionRow[];
  seq: number;
}

const ME = { email: 'interviewer@example.com' };

function buildKit(seed: KitSeed): Kit {
  const questions: Question[] = seed.questions.map((q, i) => ({ ...q, id: `q${i + 1}` }));
  const sections: SectionDef[] = seed.sections.map((s) => ({
    ...s,
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
        // Rows written by the v0 mock lack the v1 fields.
        for (const row of s.sessions) {
          row.recordingRequired ??= false;
          row.consentAt ??= null;
          row.segments ??= [];
          row.events ??= [];
          row.extensionMinutes ??= 0;
          for (const r of row.responses) {
            r.candidateAnswer ??= null;
            r.candidateAnswerAt ??= null;
            r.firstPresentedAt ??= null;
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

function computeVerdict(kit: Kit, section: SectionDef, responses: ResponseRecord[]): Verdict | null {
  if (section.scoring !== 'rubric') return null;
  const qs = section.questionKeys.map((k) => kit.questions.find((q) => q.key === k)).filter((q): q is Question => !!q);
  const byKey = new Map(responses.map((r) => [r.questionKey, r]));
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
    return store;
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
      verdict: computeVerdict(store.kit, sec, row.responses),
      serverNow: nowIso(),
      recording: { required: row.recordingRequired, consentAt: row.consentAt, segments: row.segments },
      events: row.events,
      sectionEndsAt: sectionEndsAt(row),
      extensionMinutes: row.extensionMinutes,
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
    verdict: computeVerdict(store.kit, section(row.section), row.responses),
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
      };
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
      accountTime(row);
      row.status = 'completed';
      row.endedAt = nowIso();
      row.presentedQuestionKey = null;
      row.presentedAt = null;
      commit(row);
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
      };
      if (row.status === 'ready') {
        return { ...base, phase: 'waiting', instructions: null, question: null, presentedAt: null };
      }
      if (row.status === 'completed') {
        return { ...base, phase: 'ended', instructions: null, question: null, presentedAt: null };
      }
      if (row.presentedQuestionKey === null) {
        return {
          ...base,
          phase: 'intro',
          instructions: sec.showInstructions ? store.kit.candidateInstructions : null,
          question: null,
          presentedAt: null,
        };
      }
      const q = store.kit.questions.find((x) => x.key === row.presentedQuestionKey);
      if (!q) throw new ApiError(404, 'Not found');
      const r = row.responses.find((x) => x.questionKey === q.key);
      const state: CandidateState = {
        ...base,
        phase: 'question',
        instructions: null,
        question: {
          position: sec.questionKeys.indexOf(q.key) + 1,
          total: sec.questionKeys.length,
          prompt: q.prompt,
          dataset: q.dataset,
          code: q.code,
          timeMinutes: q.timeMinutes,
        },
        presentedAt: row.presentedAt,
        answer: { text: r?.candidateAnswer ?? '', savedAt: r?.candidateAnswerAt ?? null },
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
      const key = sec.questionKeys[body.position - 1];
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
  };
  return client;
}
