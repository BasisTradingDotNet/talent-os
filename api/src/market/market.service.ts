/**
 * v1.2 make-a-market games. The interviewer starts a game from a Question.market template, trades
 * against the candidate's standing quote, reveals information and settles at the true value.
 *
 * SECURITY: candidateMarket() is an allowlist. It never carries the true value, unrevealed dice,
 * unrevealed hints, the fair value or metrics; `settlement` appears only once the game is settled.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import type { CandidateMarket, MarketConfig, MarketGame, MarketQuote, MarketTrade, SessionMarket } from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import type { TokenSession } from '../candidate-view/candidate-view.service';
import { bad } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { computeMetrics, diceFairValue, parseMarketConfig, pnlOf, positionOf } from './market-math';

const ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Caps per game, so a hostile candidate client cannot grow the tables without bound. */
export const QUOTES_PER_GAME_MAX = 1000;
export const TRADES_PER_GAME_MAX = 1000;

const GAME_INCLUDE = {
  quotes: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
  trades: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.MarketGameInclude;

type GameRow = Prisma.MarketGameGetPayload<{ include: typeof GAME_INCLUDE }>;

/** A function declaration (not a const) so TypeScript narrows after the call. */
function conflict(message: string, reason: string): never {
  throw new ConflictException({ statusCode: 409, message, reason });
}

/** What a stored game means: template, dice values, what has been revealed and what is left. */
interface Unpacked {
  config: MarketConfig;
  rolls: number[];
  reveals: string[];
  revealsRemaining: number;
  fairValue: number | null;
}

function unpack(row: GameRow): Unpacked {
  const config = parseMarketConfig(row.config);
  if (!config) throw new Error(`market game ${row.id} has an invalid config`);
  const rolls = Array.isArray(row.rolls) ? (row.rolls as unknown[]).map(Number) : [];
  if (config.kind === 'dice') {
    return {
      config,
      rolls,
      reveals: rolls.slice(0, row.revealCount).map(String),
      revealsRemaining: Math.max(0, config.dice - row.revealCount),
      fairValue: diceFairValue(rolls, row.revealCount, config.dice, config.sides),
    };
  }
  return {
    config,
    rolls,
    reveals: config.hints.slice(0, row.revealCount),
    revealsRemaining: Math.max(0, config.hints.length - row.revealCount),
    fairValue: null,
  };
}

const toQuote = (q: GameRow['quotes'][number]): MarketQuote => ({
  bid: q.bid,
  ask: q.ask,
  size: q.size,
  at: q.at.toISOString(),
  revealsSoFar: q.revealsSoFar,
});

const toTrade = (t: GameRow['trades'][number]): MarketTrade => ({
  side: t.side as MarketTrade['side'],
  price: t.price,
  size: t.size,
  at: t.at.toISOString(),
});

const tradeLikes = (row: GameRow) =>
  row.trades.map((t) => ({ side: t.side as MarketTrade['side'], price: t.price, size: t.size, quoteId: t.quoteId }));

/** INTERVIEWER view of a game: includes the true value and the fair value. */
export function toMarketGame(row: GameRow): MarketGame {
  const u = unpack(row);
  const trades = tradeLikes(row);
  const settled = row.status === 'settled';
  const last = row.quotes[row.quotes.length - 1];
  return {
    id: row.id,
    questionKey: row.questionKey,
    kind: u.config.kind,
    status: settled ? 'settled' : 'open',
    startedAt: row.startedAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    reveals: u.reveals,
    revealsRemaining: u.revealsRemaining,
    quote: last ? toQuote(last) : null,
    quotes: row.quotes.map(toQuote),
    trades: row.trades.map(toTrade),
    position: positionOf(trades),
    trueValue: row.trueValue,
    fairValue: u.fairValue,
    pnl: pnlOf(trades, row.trueValue),
    metrics: settled
      ? computeMetrics(
          row.quotes,
          trades,
          row.trueValue,
          u.config.kind === 'dice'
            ? (revealed) => diceFairValue(u.rolls, revealed, u.config.kind === 'dice' ? u.config.dice : 0, u.config.kind === 'dice' ? u.config.sides : 0)
            : null,
        )
      : null,
  };
}

/**
 * CANDIDATE view of a game. Every field is assigned explicitly from an allowlisted source. The true
 * value appears only inside `settlement`, only once settled. Never spread a row here.
 */
export function toCandidateMarket(row: GameRow, gameNumber: number, prompt: string): CandidateMarket {
  const u = unpack(row);
  const trades = tradeLikes(row);
  const settled = row.status === 'settled';
  const last = row.quotes[row.quotes.length - 1];
  return {
    gameNumber,
    prompt,
    unit: u.config.kind === 'estimate' ? u.config.unit : null,
    reveals: u.reveals,
    status: settled ? 'settled' : 'open',
    quote: last ? { bid: last.bid, ask: last.ask, size: last.size } : null,
    trades: row.trades.map((t) => ({
      side: t.side === 'buy' ? 'you_sold' : 'you_bought',
      price: t.price,
      size: t.size,
      at: t.at.toISOString(),
    })),
    position: positionOf(trades),
    settlement: settled ? { value: row.trueValue, pnl: pnlOf(trades, row.trueValue) } : null,
  };
}

@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- builders (called by the Session / CandidateState builders) ---------------------------

  /** Interviewer view. Null unless the session's section is scored 'market'. */
  async sessionMarket(sessionId: string): Promise<SessionMarket | null> {
    const s = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        section: true,
        kit: { select: { sections: true } },
        marketGames: { include: GAME_INCLUDE, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!s) return null;
    const section = ((s.kit.sections as unknown as SectionSeed[]) ?? []).find((x) => x.key === s.section);
    if (!section || section.scoring !== 'market') return null;
    const games = s.marketGames.map(toMarketGame);
    return { games, activeGameId: games.find((g) => g.status === 'open')?.id ?? null };
  }

  /** Candidate view: the open game, else the last settled one; null when the session has none. */
  async candidateMarket(sessionId: string): Promise<CandidateMarket | null> {
    const s = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        kitId: true,
        marketGames: { include: GAME_INCLUDE, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!s || s.marketGames.length === 0) return null;
    let idx = s.marketGames.findIndex((g) => g.status === 'open');
    if (idx < 0) idx = s.marketGames.length - 1;
    const row = s.marketGames[idx];
    const q = await this.prisma.question.findUnique({
      where: { kitId_key: { kitId: s.kitId, key: row.questionKey } },
      select: { prompt: true },
    });
    return toCandidateMarket(row, idx + 1, q?.prompt ?? '');
  }

  // ---- interviewer ------------------------------------------------------------------------

  private async session(orgId: string, sessionId: string) {
    const s = await this.prisma.session.findFirst({
      where: { id: sessionId, orgId },
      select: { id: true, kitId: true, section: true, status: true },
    });
    if (!s) throw new NotFoundException('session not found');
    return s;
  }

  private async game(sessionId: string, gameId: string): Promise<GameRow> {
    if (!ID.test(gameId)) throw new NotFoundException('game not found');
    const g = await this.prisma.marketGame.findFirst({ where: { id: gameId, sessionId }, include: GAME_INCLUDE });
    if (!g) throw new NotFoundException('game not found');
    return g;
  }

  private bump(sessionId: string) {
    return this.prisma.session.update({ where: { id: sessionId }, data: { version: { increment: 1 } } });
  }

  /** Session live; question in the section with mode 'market'; one open game per session (409). */
  async start(orgId: string, sessionId: string, questionKey: string): Promise<void> {
    const s = await this.session(orgId, sessionId);
    if (s.status !== 'live') conflict('session is not live', 'not_live');
    const q = await this.prisma.question.findUnique({ where: { kitId_key: { kitId: s.kitId, key: questionKey } } });
    if (!q || q.section !== s.section) bad(`question ${questionKey} is not in section ${s.section}`);
    if (q.mode !== 'market') bad(`question ${questionKey} is not a market question`);
    const config = parseMarketConfig((q as { market?: unknown }).market);
    if (!config) bad(`question ${questionKey} has no market template`);
    const open = await this.prisma.marketGame.findFirst({ where: { sessionId: s.id, status: 'open' }, select: { id: true } });
    if (open) conflict('a game is already open', 'game_open');

    let rolls: number[] | undefined;
    let trueValue: number;
    if (config.kind === 'dice') {
      rolls = Array.from({ length: config.dice }, () => randomInt(1, config.sides + 1));
      trueValue = rolls.reduce((a, b) => a + b, 0);
    } else {
      trueValue = config.trueValue;
    }
    await this.prisma.$transaction([
      this.prisma.marketGame.create({
        data: { sessionId: s.id, questionKey, kind: config.kind, status: 'open', config, rolls, trueValue, revealCount: 0 },
      }),
      this.bump(s.id),
    ]);
  }

  /** Fills against the candidate's current quote: buy at the ask, sell at the bid. */
  async trade(orgId: string, sessionId: string, gameId: string, side: 'buy' | 'sell', size: number | undefined): Promise<void> {
    const s = await this.session(orgId, sessionId);
    const g = await this.game(s.id, gameId);
    if (g.status !== 'open') conflict('game is settled', 'settled');
    const quote = g.quotes[g.quotes.length - 1];
    if (!quote) conflict('the candidate has no quote on the table', 'no_quote');
    const qty = size ?? quote.size;
    if (qty > quote.size) bad(`size must not exceed the quote size (${quote.size})`);
    if (g.trades.length >= TRADES_PER_GAME_MAX) conflict('too many trades', 'too_many_trades');
    await this.prisma.$transaction([
      this.prisma.marketTrade.create({
        data: { gameId: g.id, quoteId: quote.id, side, price: side === 'buy' ? quote.ask : quote.bid, size: qty },
      }),
      this.bump(s.id),
    ]);
  }

  /** Dice: shows the next die. Estimate: the next hint. 409 when nothing is left. */
  async reveal(orgId: string, sessionId: string, gameId: string): Promise<void> {
    const s = await this.session(orgId, sessionId);
    const g = await this.game(s.id, gameId);
    if (g.status !== 'open') conflict('game is settled', 'settled');
    if (unpack(g).revealsRemaining === 0) conflict('nothing left to reveal', 'no_reveals');
    await this.prisma.$transaction([
      this.prisma.marketGame.update({ where: { id: g.id }, data: { revealCount: { increment: 1 } } }),
      this.bump(s.id),
    ]);
  }

  async settle(orgId: string, sessionId: string, gameId: string): Promise<void> {
    const s = await this.session(orgId, sessionId);
    const g = await this.game(s.id, gameId);
    if (g.status !== 'open') conflict('game is already settled', 'settled');
    await this.prisma.$transaction([
      this.prisma.marketGame.update({ where: { id: g.id }, data: { status: 'settled', settledAt: new Date() } }),
      this.bump(s.id),
    ]);
  }

  // ---- candidate --------------------------------------------------------------------------

  /** Records a validated quote on the open game. 409 unless the session is live and a game is open. */
  async quote(ts: TokenSession, bid: number, ask: number, size: number): Promise<void> {
    const s = ts.session;
    if (s.status !== 'live') conflict('session is not live', 'not_live');
    const g = await this.prisma.marketGame.findFirst({
      where: { sessionId: s.id, status: 'open' },
      select: { id: true, revealCount: true, _count: { select: { quotes: true } } },
    });
    if (!g) conflict('no open game', 'no_game');
    if (g._count.quotes >= QUOTES_PER_GAME_MAX) conflict('too many quotes', 'too_many_quotes');
    await this.prisma.$transaction([
      this.prisma.marketQuote.create({ data: { gameId: g.id, bid, ask, size, revealsSoFar: g.revealCount } }),
      this.bump(s.id),
    ]);
  }
}
