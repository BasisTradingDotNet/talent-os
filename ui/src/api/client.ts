import type {
  Band,
  CandidateDetail,
  CandidateEvents,
  CandidateState,
  CandidateSummary,
  ChunkAck,
  CreateCandidate,
  CreateSession,
  ExtendSession,
  Kit,
  Me,
  PresentQuestion,
  SaveAnswer,
  SavedAnswer,
  Session,
  StartRecording,
  StartedRecording,
  UpdateCandidate,
  UpdateRating,
  UpdateResponse,
  UpdateSession,
} from '@contracts/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Parsed JSON body when the server sent one (e.g. `{ expected }` on a chunk 409). */
    public readonly data: unknown = undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** One typed function per endpoint in api/src/contracts/api.ts. */
export interface ApiClient {
  // Kit
  getKit(): Promise<Kit>;
  putSectionBands(key: string, bands: Band[]): Promise<Kit>;
  // Identity
  getMe(): Promise<Me>;
  // Sessions
  createSession(body: CreateSession): Promise<Session>;
  getSession(id: string): Promise<Session>;
  startSession(id: string): Promise<Session>;
  presentQuestion(id: string, body: PresentQuestion): Promise<Session>;
  updateResponse(id: string, questionKey: string, body: UpdateResponse): Promise<Session>;
  updateRating(id: string, dimensionId: number, body: UpdateRating): Promise<Session>;
  updateSession(id: string, body: UpdateSession): Promise<Session>;
  endSession(id: string): Promise<Session>;
  reopenSession(id: string): Promise<Session>;
  /** v1.1: add minutes to the section time limit (ready or live). */
  extendSession(id: string, body: ExtendSession): Promise<Session>;
  // Candidates
  listCandidates(): Promise<CandidateSummary[]>;
  createCandidate(body: CreateCandidate): Promise<CandidateDetail>;
  getCandidate(id: string): Promise<CandidateDetail>;
  updateCandidate(id: string, body: UpdateCandidate): Promise<CandidateDetail>;
  // Candidate view (public, token-gated). The candidate page calls nothing else.
  getCandidateState(token: string): Promise<CandidateState>;
  // v1: consent, answer, recording upload and integrity events — all token-gated.
  postConsent(token: string): Promise<CandidateState>;
  saveAnswer(token: string, body: SaveAnswer): Promise<SavedAnswer>;
  startRecording(token: string, body: StartRecording): Promise<StartedRecording>;
  /** Raw bytes; `keepalive` lets a small final chunk survive page unload. */
  putChunk(token: string, segmentId: string, seq: number, blob: Blob, keepalive?: boolean): Promise<ChunkAck>;
  stopRecording(token: string, segmentId: string, keepalive?: boolean): Promise<void>;
  postEvents(token: string, body: CandidateEvents, keepalive?: boolean): Promise<void>;
}

const BASE = '/api';

async function parseError(method: string, path: string, res: Response): Promise<ApiError> {
  let message = `${method} ${path} → ${res.status}`;
  let data: unknown;
  try {
    data = await res.json();
    const d = data as { message?: unknown } | null;
    if (d && typeof d.message === 'string') message = d.message;
    else if (Array.isArray(d?.message)) message = (d!.message as unknown[]).join('; ');
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, message, data);
}

async function request<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    keepalive,
  });
  if (!res.ok) throw await parseError(method, path, res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function requestRaw<T>(method: string, path: string, blob: Blob, keepalive = false): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
    credentials: 'same-origin',
    keepalive,
  });
  if (!res.ok) throw await parseError(method, path, res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const httpClient: ApiClient = {
  getKit: () => request('GET', '/kit'),
  putSectionBands: (key, bands) => request('PUT', `/kit/sections/${enc(key)}/bands`, bands),
  getMe: () => request('GET', '/me'),
  createSession: (body) => request('POST', '/sessions', body),
  getSession: (id) => request('GET', `/sessions/${enc(id)}`),
  startSession: (id) => request('POST', `/sessions/${enc(id)}/start`),
  presentQuestion: (id, body) => request('POST', `/sessions/${enc(id)}/present`, body),
  updateResponse: (id, key, body) => request('PUT', `/sessions/${enc(id)}/responses/${enc(key)}`, body),
  updateRating: (id, dim, body) => request('PUT', `/sessions/${enc(id)}/ratings/${dim}`, body),
  updateSession: (id, body) => request('PATCH', `/sessions/${enc(id)}`, body),
  endSession: (id) => request('POST', `/sessions/${enc(id)}/end`),
  reopenSession: (id) => request('POST', `/sessions/${enc(id)}/reopen`),
  extendSession: (id, body) => request('POST', `/sessions/${enc(id)}/extend`, body),
  listCandidates: () => request('GET', '/candidates'),
  createCandidate: (body) => request('POST', '/candidates', body),
  getCandidate: (id) => request('GET', `/candidates/${enc(id)}`),
  updateCandidate: (id, body) => request('PATCH', `/candidates/${enc(id)}`, body),
  getCandidateState: (token) => request('GET', `/candidate/${enc(token)}/state`),
  postConsent: (token) => request('POST', `/candidate/${enc(token)}/consent`, { accepted: true }),
  saveAnswer: (token, body) => request('PUT', `/candidate/${enc(token)}/answer`, body),
  startRecording: (token, body) => request('POST', `/candidate/${enc(token)}/recordings`, body),
  putChunk: (token, segmentId, seq, blob, keepalive) =>
    requestRaw('PUT', `/candidate/${enc(token)}/recordings/${enc(segmentId)}/chunks/${seq}`, blob, keepalive),
  stopRecording: (token, segmentId, keepalive) =>
    request('POST', `/candidate/${enc(token)}/recordings/${enc(segmentId)}/stop`, undefined, keepalive),
  postEvents: (token, body, keepalive) => request('POST', `/candidate/${enc(token)}/events`, body, keepalive),
};

/** Export links are plain navigations (attachments), not fetches. */
export const exportUrls = {
  candidatesCsv: `${BASE}/export/candidates.csv`,
  candidateJson: (id: string) => `${BASE}/export/candidates/${enc(id)}.json`,
};

/** Protected playback URL for a `<video>` element (HTTP Range supported server-side). */
export function recordingUrl(sessionId: string, segmentId: string): string {
  return `${BASE}/sessions/${enc(sessionId)}/recordings/${enc(segmentId)}`;
}

export const IS_MOCK = import.meta.env.VITE_MOCK === '1';

let current: ApiClient = httpClient;

export function api(): ApiClient {
  return current;
}

/** Resolves the client once at bootstrap. The mock is a dynamic import so it never ships in prod. */
export async function initApi(): Promise<ApiClient> {
  if (IS_MOCK) {
    const { createMockClient } = await import('./mock');
    current = await createMockClient();
  }
  return current;
}
