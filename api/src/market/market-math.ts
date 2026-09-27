/**
 * v1.2 make-a-market: pure scoring functions. No I/O, no Nest — unit-tested directly.
 *
 * Sign convention: everything is from the CANDIDATE's side. The interviewer "buys" by lifting the
 * candidate's ask (candidate sold, position −size) and "sells" by hitting the bid (candidate
 * bought, position +size).
 */
import type { MarketConfig, MarketMetrics } from '../contracts/api';

export interface QuoteLike {
  id: string;
  bid: number;
  ask: number;
  size: number;
  revealsSoFar: number;
}

export interface TradeLike {
  side: 'buy' | 'sell';
  price: number;
  size: number;
  /** The quote that was hit (null for legacy rows). */
  quoteId: string | null;
}

/** Defensive read of Question.market / MarketGame.config. Null unless it is a usable template. */
export function parseMarketConfig(raw: unknown): MarketConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'dice') {
    const dice = o.dice;
    const sides = o.sides;
    if (typeof dice !== 'number' || !Number.isInteger(dice) || dice < 1 || dice > 100) return null;
    if (typeof sides !== 'number' || !Number.isInteger(sides) || sides < 2 || sides > 1000) return null;
    return { kind: 'dice', dice, sides };
  }
  if (o.kind === 'estimate') {
    const trueValue = o.trueValue;
    if (typeof trueValue !== 'number' || !Number.isFinite(trueValue)) return null;
    const hints = Array.isArray(o.hints) ? o.hints.filter((h): h is string => typeof h === 'string') : [];
    return { kind: 'estimate', trueValue, unit: typeof o.unit === 'string' ? o.unit : '', hints };
  }
  return null;
}

/** Expected total given the dice revealed so far: Σ revealed + remaining × (sides + 1) / 2. */
export function diceFairValue(rolls: number[], revealed: number, dice: number, sides: number): number {
  const shown = Math.max(0, Math.min(revealed, rolls.length));
  let sum = 0;
  for (let i = 0; i < shown; i += 1) sum += rolls[i];
  return sum + Math.max(0, dice - shown) * ((sides + 1) / 2);
}

/** Candidate's net position: + long. */
export function positionOf(trades: readonly TradeLike[]): number {
  let pos = 0;
  for (const t of trades) pos += t.side === 'sell' ? t.size : -t.size;
  return pos;
}

/** Largest |position| the candidate carried at any point. */
export function maxAbsPosition(trades: readonly TradeLike[]): number {
  let pos = 0;
  let max = 0;
  for (const t of trades) {
    pos += t.side === 'sell' ? t.size : -t.size;
    max = Math.max(max, Math.abs(pos));
  }
  return max;
}

/** Candidate P&L marked at `value`: Σ buys (price − V)·q + Σ sells (V − price)·q. */
export function pnlOf(trades: readonly TradeLike[], value: number): number {
  let pnl = 0;
  for (const t of trades) pnl += t.side === 'buy' ? (t.price - value) * t.size : (value - t.price) * t.size;
  return round(pnl);
}

export function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const mid = (q: QuoteLike): number => (q.bid + q.ask) / 2;

/**
 * Settled-game metrics. `fairAt` gives the fair value at a given reveal count (dice only); pass null
 * for estimate games, whose fair-value metrics are null. Ratios with an empty denominator are null.
 */
export function computeMetrics(
  quotes: readonly QuoteLike[],
  trades: readonly TradeLike[],
  value: number,
  fairAt: ((revealsSoFar: number) => number) | null,
): MarketMetrics {
  const n = quotes.length;
  const avgSpread = n ? round(quotes.reduce((a, q) => a + (q.ask - q.bid), 0) / n) : 0;

  let fairInsideRate: number | null = null;
  let meanMidError: number | null = null;
  if (fairAt && n) {
    let inside = 0;
    let err = 0;
    for (const q of quotes) {
      const fair = fairAt(q.revealsSoFar);
      if (q.bid <= fair && fair <= q.ask) inside += 1;
      err += Math.abs(mid(q) - fair);
    }
    fairInsideRate = round(inside / n);
    meanMidError = round(err / n);
  }

  // Skew: after a buy the next quote's mid should move up; after a sell, down.
  const index = new Map(quotes.map((q, i) => [q.id, i]));
  let withNext = 0;
  let skewed = 0;
  for (const t of trades) {
    const i = t.quoteId ? index.get(t.quoteId) : undefined;
    if (i === undefined || i + 1 >= n) continue;
    withNext += 1;
    const delta = mid(quotes[i + 1]) - mid(quotes[i]);
    if ((t.side === 'buy' && delta > 0) || (t.side === 'sell' && delta < 0)) skewed += 1;
  }

  return {
    quotes: n,
    avgSpread,
    fairInsideRate,
    meanMidError,
    skewAfterTradeRate: withNext ? round(skewed / withNext) : null,
    pnl: pnlOf(trades, value),
    maxAbsPosition: maxAbsPosition(trades),
  };
}
