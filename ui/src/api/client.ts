import type {
  Band,
  CandidateDetail,
  CandidateState,
  CandidateSummary,
  CreateCandidate,
  CreateSession,
  Kit,
  Me,
  PresentQuestion,
  Session,
  UpdateCandidate,
  UpdateRating,
  UpdateResponse,
  UpdateSession,
} from '@contracts/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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
  // Candidates
  listCandidates(): Promise<CandidateSummary[]>;
  createCandidate(body: CreateCandidate): Promise<CandidateDetail>;
  getCandidate(id: string): Promise<CandidateDetail>;
  updateCandidate(id: string, body: UpdateCandidate): Promise<CandidateDetail>;
  // Candidate view (public, token-gated). The candidate page calls nothing else.
  getCandidateState(token: string): Promise<CandidateState>;
}

const BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = `${method} ${path} → ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.message === 'string') message = data.message;
      else if (Array.isArray(data?.message)) message = data.message.join('; ');
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
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
  listCandidates: () => request('GET', '/candidates'),
  createCandidate: (body) => request('POST', '/candidates', body),
  getCandidate: (id) => request('GET', `/candidates/${enc(id)}`),
  updateCandidate: (id, body) => request('PATCH', `/candidates/${enc(id)}`, body),
  getCandidateState: (token) => request('GET', `/candidate/${enc(token)}/state`),
};

/** Export links are plain navigations (attachments), not fetches. */
export const exportUrls = {
  candidatesCsv: `${BASE}/export/candidates.csv`,
  candidateJson: (id: string) => `${BASE}/export/candidates/${enc(id)}.json`,
};

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
