/**
 * In-memory implementation of ApiClient for `VITE_MOCK=1`, seeded from kit/fixtures/sample.seed.json.
 * The store lives in localStorage so a candidate tab follows the console tab. Loaded by dynamic
 * import only; never part of the production bundle.
 */
import type {
  Band,
  CandidateDetail,
  CandidateState,
  CandidateSummary,
  DimensionRating,
  Kit,
  Question,
  ResponseRecord,
  SectionDef,
  Session,
  SessionSummary,
  Verdict,
} from '@contracts/api';
import type { KitSeed } from '@contracts/kit-seed';
import { ApiError, type ApiClient } from './client';

const KEY = 'talent-os-mock-v1';

interface CandidateRow {
  id: string;
  applicationId: string;
  name: string;
  email: string | null;
  source: string | null;
  notes: string | null;
  overallDecision: string | null;
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
      if (s && s.kit && s.candidates && s.sessions) return s;
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
      section(body.section);
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
      Object.assign(row, body);
      commit();
      return toCandidateDetail(row);
    },
    async getCandidateState(token) {
      await delay();
      fresh();
      const row = store.sessions.find((s) => s.token === token);
      if (!row) throw new ApiError(404, 'Not found');
      const sec = section(row.section);
      if (!sec.candidateView) throw new ApiError(404, 'Not found');
      const base = {
        orgName: store.orgName,
        sectionLabel: sec.candidateLabel,
        serverNow: nowIso(),
        version: row.version,
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
      };
      return state;
    },
  };
  return client;
}
