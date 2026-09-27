/**
 * v1.2 make-a-market endpoints (api/src/contracts/api.ts, "make-a-market"). Same conventions as
 * ../api/client.ts, whose `request` helper is not exported: JSON in/out, same-origin credentials,
 * failures thrown as ApiError with the status and the parsed body so `err.reason` yields a 409's
 * reason ('no_quote', …). Both panels take a `client?: MarketApi`; MarketDemo injects a mock.
 */
import type { CandidateState, MarketTradeRequest, QuoteRequest, Session, StartMarketGame } from '@contracts/api';
import { ApiError } from '../api/client';

export interface MarketApi {
  /** POST /api/sessions/:id/market/games (live; one open game at a time). */
  startGame(sessionId: string, body: StartMarketGame): Promise<Session>;
  /** POST …/games/:gameId/trade — 409 {reason:'no_quote'} when the candidate has no quote. */
  trade(sessionId: string, gameId: string, body: MarketTradeRequest): Promise<Session>;
  /** POST …/games/:gameId/reveal — 409 when nothing is left to reveal. */
  reveal(sessionId: string, gameId: string): Promise<Session>;
  /** POST …/games/:gameId/settle. */
  settle(sessionId: string, gameId: string): Promise<Session>;
  /** PUT /api/candidate/:token/quote — 400 unless bid < ask, size integer 1–100; 409 when no open game. */
  putQuote(token: string, body: QuoteRequest): Promise<CandidateState>;
}

const BASE = '/api';
const enc = encodeURIComponent;

async function request<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = `${method} ${path} → ${res.status}`;
    let data: unknown;
    try {
      data = await res.json();
      const d = data as { message?: unknown; reason?: unknown } | null;
      if (d && typeof d.message === 'string') message = d.message;
      else if (Array.isArray(d?.message)) message = (d!.message as unknown[]).join('; ');
      else if (d && typeof d.reason === 'string') message = d.reason;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message, data);
  }
  return (await res.json()) as T;
}

export const httpMarketApi: MarketApi = {
  startGame: (id, body) => request('POST', `/sessions/${enc(id)}/market/games`, body),
  trade: (id, gameId, body) => request('POST', `/sessions/${enc(id)}/market/games/${enc(gameId)}/trade`, body),
  reveal: (id, gameId) => request('POST', `/sessions/${enc(id)}/market/games/${enc(gameId)}/reveal`),
  settle: (id, gameId) => request('POST', `/sessions/${enc(id)}/market/games/${enc(gameId)}/settle`),
  putQuote: (token, body) => request('PUT', `/candidate/${enc(token)}/quote`, body),
};

const REASONS: Record<string, string> = {
  no_quote: 'Candidate has no quote on the table',
  not_live: 'The session is not live',
  no_reveals: 'Nothing left to reveal',
  nothing_to_reveal: 'Nothing left to reveal',
  game_open: 'A game is already open — settle it first',
  open_game: 'A game is already open — settle it first',
  not_open: 'This game is already settled',
  settled: 'This game is already settled',
  no_game: 'No open game',
  no_open_game: 'No open game',
};

/** Interviewer-facing message for a failed market call (409 reasons per the contract). */
export function marketErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const r = e.reason;
    if (r && REASONS[r]) return REASONS[r];
    if (e.status === 409) return r ? `Not allowed right now (${r})` : 'Not allowed right now';
    if (e.status === 400) return e.message || 'Invalid request';
    return e.message || `Request failed (${e.status})`;
  }
  return e instanceof Error ? e.message : 'Request failed';
}

/** Candidate-facing message for a failed quote. Never echoes server internals. */
export function quoteErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return 'There is no open game right now.';
    if (e.status === 400) return 'Check your quote: bid must be below ask and size a whole number from 1 to 100.';
  }
  return 'Could not send your quote — please try again.';
}
