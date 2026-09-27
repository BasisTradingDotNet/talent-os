import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-setup';
import type { CandidateDetail, CandidateMarket, CandidateState, MarketGame, Session } from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import { PrismaService } from '../prisma/prisma.service';
import { seedKitFile } from '../seed/seed-kit';
import { MarketService } from './market.service';

const API_DIR = resolve(__dirname, '../..');
const FIXTURE = resolve(API_DIR, '../kit/fixtures/sample.seed.json');
const AUTH = { 'cf-access-authenticated-user-email': 'tester@example.com' };

/** Exactly the CandidateMarket keys — anything else is a leak. */
const CANDIDATE_MARKET_KEYS = ['gameNumber', 'position', 'prompt', 'quote', 'reveals', 'settlement', 'status', 'trades', 'unit'];
const SECRET_FRAGMENTS = ['trueValue', 'fairValue', 'rolls', 'metrics', 'config', 'hints', 'revealCount', 'revealsRemaining', 'pnl'];

const A2_PROMPT_MARK = 'ESTIMATE-PROMPT-7f3a';

describe('make-a-market (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let market: MarketService;
  let http: ReturnType<typeof request>;
  let sessionId: string;
  let quoteUrl: string;

  const games = (s: Session): MarketGame[] => s.market!.games;
  const active = (s: Session): MarketGame => games(s).find((g) => g.id === s.market!.activeGameId)!;

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { cwd: API_DIR, env: process.env, stdio: 'ignore' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    market = app.get(MarketService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Organization","Job","Kit","Question","Candidate","Application","Session","Response","Rating","RecordingSegment","SessionEvent","MarketGame","MarketQuote","MarketTrade" CASCADE',
    );
    await seedKitFile(prisma, FIXTURE, { orgSlug: 'g20' });
    // Turn fixture section A into a market section with one dice and one estimate template.
    const kit = await prisma.kit.findFirstOrThrow({ where: { slug: 'sample' } });
    const sections = (kit.sections as unknown as SectionSeed[]).map((s) => (s.key === 'A' ? { ...s, scoring: 'market' } : s));
    await prisma.kit.update({ where: { id: kit.id }, data: { sections: sections as unknown as object } });
    await prisma.question.update({
      where: { kitId_key: { kitId: kit.id, key: 'A1' } },
      data: { mode: 'market', market: { kind: 'dice', dice: 2, sides: 6 } },
    });
    await prisma.question.update({
      where: { kitId_key: { kitId: kit.id, key: 'A2' } },
      data: {
        mode: 'market',
        prompt: `How far is the Moon? ${A2_PROMPT_MARK}`,
        market: { kind: 'estimate', trueValue: 10, unit: 'm', hints: ['Hint one', 'Hint two'] },
      },
    });
    http = request(app.getHttpServer());

    const candidate = (await http.post('/api/candidates').set(AUTH).send({ name: 'Market Maker' }).expect(201)).body as CandidateDetail;
    const session = (await http.post('/api/sessions').set(AUTH).send({ candidateId: candidate.id, section: 'A' }).expect(201)).body as Session;
    sessionId = session.id;
    quoteUrl = `/api/candidate/${session.candidateUrl!.split('/c/')[1]}/quote`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses to start a game before the session is live', async () => {
    const res = await http.post(`/api/sessions/${sessionId}/market/games`).set(AUTH).send({ questionKey: 'A2' }).expect(409);
    expect(res.body.reason).toBe('not_live');
    await http.post(`/api/sessions/${sessionId}/start`).set(AUTH).expect(201);
  });

  it('candidate quote without an open game → 409', async () => {
    const res = await http.put(quoteUrl).send({ bid: 9, ask: 12, size: 10 }).expect(409);
    expect(res.body.reason).toBe('no_game');
  });

  it('runs an estimate game end to end with a leak-free candidate view', async () => {
    await http.post(`/api/sessions/${sessionId}/market/games`).set(AUTH).send({ questionKey: 'A3' }).expect(400); // not a market question
    await http.post(`/api/sessions/${sessionId}/market/games`).set(AUTH).send({ questionKey: 'S1.1' }).expect(400); // not in section
    await http.post(`/api/sessions/${sessionId}/market/games`).set(AUTH).send({}).expect(400);

    let session = (await http.post(`/api/sessions/${sessionId}/market/games`).set(AUTH).send({ questionKey: 'A2' }).expect(201)).body as Session;
    expect(session.market).not.toBeNull();
    expect(games(session)).toHaveLength(1);
    let game = active(session);
    expect(game).toMatchObject({ questionKey: 'A2', kind: 'estimate', status: 'open', settledAt: null, reveals: [], revealsRemaining: 2, quote: null, position: 0, trueValue: 10, fairValue: null, pnl: 0, metrics: null });
    expect(Object.keys(game).sort()).toEqual([
      'fairValue', 'id', 'kind', 'metrics', 'pnl', 'position', 'questionKey', 'quote', 'quotes', 'reveals', 'revealsRemaining', 'settledAt', 'startedAt', 'status', 'trades', 'trueValue',
    ]);

    // One open game per session.
    const second = await http.post(`/api/sessions/${sessionId}/market/games`).set(AUTH).send({ questionKey: 'A1' }).expect(409);
    expect(second.body.reason).toBe('game_open');

    // No quote yet.
    const noQuote = await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/trade`).set(AUTH).send({ side: 'buy' }).expect(409);
    expect(noQuote.body).toMatchObject({ reason: 'no_quote' });

    // Quote validation.
    for (const body of [
      { bid: 12, ask: 12, size: 1 },
      { bid: 13, ask: 12, size: 1 },
      { bid: '9', ask: 12, size: 1 },
      { bid: 9, ask: 12, size: 0 },
      { bid: 9, ask: 12, size: 101 },
      { bid: 9, ask: 12, size: 1.5 },
      { bid: 9, ask: 12 },
      { bid: 9, ask: 1e400, size: 1 },
      {},
    ]) {
      await http.put(quoteUrl).send(body).expect(400);
    }
    await http.put('/api/candidate/not-a-real-token-00000000/quote').send({ bid: 9, ask: 12, size: 1 }).expect(404);

    // The candidate quotes 9 / 12, 10 up.
    const before = (await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { version: true } })).version;
    const quoted = await http.put(quoteUrl).send({ bid: 9, ask: 12, size: 10 }).expect(200);
    expect(quoted.headers['cache-control']).toBe('no-store');
    const state = quoted.body as CandidateState;
    expect(state.phase).toBe('intro');
    expect(state.version).toBe(before + 1); // both screens refresh
    const cm = state.market!;
    expect(Object.keys(cm).sort()).toEqual(CANDIDATE_MARKET_KEYS);
    expect(cm).toEqual({
      gameNumber: 1,
      prompt: `How far is the Moon? ${A2_PROMPT_MARK}`,
      unit: 'm',
      reveals: [],
      status: 'open',
      quote: { bid: 9, ask: 12, size: 10 },
      trades: [],
      position: 0,
      settlement: null,
    });
    const json = JSON.stringify(state);
    for (const fragment of SECRET_FRAGMENTS) expect(json).not.toContain(fragment);
    expect(json).not.toContain('Hint one');
    expect(json).not.toContain('A2');

    // Interviewer lifts the ask for 1 (size must not exceed the quote).
    await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/trade`).set(AUTH).send({ side: 'buy', size: 11 }).expect(400);
    await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/trade`).set(AUTH).send({ side: 'hold' }).expect(400);
    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/trade`).set(AUTH).send({ side: 'buy', size: 1 }).expect(201)).body as Session;
    game = active(session);
    expect(game.trades).toHaveLength(1);
    expect(game.trades[0]).toMatchObject({ side: 'buy', price: 12, size: 1 });
    expect(game.position).toBe(-1);
    expect(game.pnl).toBe(2); // sold at 12, true value 10
    expect(game.quote).toMatchObject({ bid: 9, ask: 12, size: 10, revealsSoFar: 0 });

    // Reveal the first hint; the candidate re-quotes higher (skewing away from the lifted ask).
    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/reveal`).set(AUTH).expect(201)).body as Session;
    expect(active(session).reveals).toEqual(['Hint one']);
    expect(active(session).revealsRemaining).toBe(1);
    const requoted = (await http.put(quoteUrl).send({ bid: 10, ask: 13, size: 5 }).expect(200)).body as CandidateState;
    expect(requoted.market).toMatchObject({ reveals: ['Hint one'], quote: { bid: 10, ask: 13, size: 5 }, position: -1, settlement: null });
    expect(requoted.market!.trades).toEqual([{ side: 'you_sold', price: 12, size: 1, at: expect.any(String) }]);
    expect(JSON.stringify(requoted)).not.toContain('Hint two');

    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/reveal`).set(AUTH).expect(201)).body as Session;
    expect(active(session).reveals).toEqual(['Hint one', 'Hint two']);
    const exhausted = await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/reveal`).set(AUTH).expect(409);
    expect(exhausted.body.reason).toBe('no_reveals');

    // Interviewer hits the bid for the full quote size (default size).
    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/trade`).set(AUTH).send({ side: 'sell' }).expect(201)).body as Session;
    game = active(session);
    expect(game.trades[1]).toMatchObject({ side: 'sell', price: 10, size: 5 });
    expect(game.position).toBe(4);
    expect(game.pnl).toBe(2);
    expect(game.quotes.map((q) => q.revealsSoFar)).toEqual([0, 1]);

    // Settle.
    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/settle`).set(AUTH).expect(201)).body as Session;
    expect(session.market!.activeGameId).toBeNull();
    game = games(session)[0];
    expect(game.status).toBe('settled');
    expect(game.settledAt).toBeTruthy();
    expect(game.metrics).toEqual({
      quotes: 2,
      avgSpread: 3,
      fairInsideRate: null,
      meanMidError: null,
      skewAfterTradeRate: 1, // the buy on quote 1 was followed by a higher mid; the sell had no next quote
      pnl: 2,
      maxAbsPosition: 4,
    });

    // Nothing more happens on a settled game.
    for (const action of ['trade', 'reveal', 'settle']) {
      const res = await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/${action}`).set(AUTH).send({ side: 'buy' }).expect(409);
      expect(res.body.reason).toBe('settled');
    }
    const closed = await http.put(quoteUrl).send({ bid: 9, ask: 12, size: 1 }).expect(409);
    expect(closed.body.reason).toBe('no_game');
    await http.post(`/api/sessions/${sessionId}/market/games/nope-nope-nope/settle`).set(AUTH).expect(404);

    // The candidate's view of the last settled game carries the settlement — and nothing else.
    const settled = (await market.candidateMarket(sessionId)) as CandidateMarket;
    expect(Object.keys(settled).sort()).toEqual(CANDIDATE_MARKET_KEYS);
    expect(settled).toMatchObject({ gameNumber: 1, status: 'settled', reveals: ['Hint one', 'Hint two'], position: 4, settlement: { value: 10, pnl: 2 } });
  });

  it('runs a dice game: rolls stay hidden until revealed; fair value follows the reveals', async () => {
    let session = (await http.post(`/api/sessions/${sessionId}/market/games`).set(AUTH).send({ questionKey: 'A1' }).expect(201)).body as Session;
    expect(games(session)).toHaveLength(2);
    let game = active(session);
    expect(game).toMatchObject({ kind: 'dice', reveals: [], revealsRemaining: 2, fairValue: 7 });
    expect(game.trueValue).toBeGreaterThanOrEqual(2);
    expect(game.trueValue).toBeLessThanOrEqual(12);
    const stored = await prisma.marketGame.findUniqueOrThrow({ where: { id: game.id } });
    const rolls = stored.rolls as number[];
    expect(rolls).toHaveLength(2);
    expect(rolls[0] + rolls[1]).toBe(game.trueValue);

    let state = (await http.put(quoteUrl).send({ bid: 6, ask: 8, size: 3 }).expect(200)).body as CandidateState;
    expect(Object.keys(state.market!).sort()).toEqual(CANDIDATE_MARKET_KEYS);
    expect(state.market).toMatchObject({ gameNumber: 2, unit: null, reveals: [], status: 'open', settlement: null });
    const json = JSON.stringify(state.market);
    for (const fragment of SECRET_FRAGMENTS) expect(json).not.toContain(fragment);

    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/reveal`).set(AUTH).expect(201)).body as Session;
    game = active(session);
    expect(game.reveals).toEqual([String(rolls[0])]);
    expect(game.fairValue).toBe(rolls[0] + 3.5);
    state = (await http.put(quoteUrl).send({ bid: 5, ask: 9, size: 2 }).expect(200)).body as CandidateState;
    expect(state.market!.reveals).toEqual([String(rolls[0])]);

    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/reveal`).set(AUTH).expect(201)).body as Session;
    game = active(session);
    expect(game.reveals).toEqual(rolls.map(String));
    expect(game.fairValue).toBe(game.trueValue);
    await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/reveal`).set(AUTH).expect(409);

    session = (await http.post(`/api/sessions/${sessionId}/market/games/${game.id}/settle`).set(AUTH).expect(201)).body as Session;
    game = games(session)[1];
    expect(game.metrics).toMatchObject({ quotes: 2, avgSpread: 3, skewAfterTradeRate: null, pnl: 0, maxAbsPosition: 0 });
    // Quote 1 (6–8) contained the prior fair value 7; quote 2 (5–9) contains rolls[0] + 3.5 unless the die was 1 or 6.
    expect(game.metrics!.fairInsideRate).toBe(rolls[0] === 1 || rolls[0] === 6 ? 0.5 : 1);
    expect(game.metrics!.meanMidError).toBeCloseTo(Math.abs(7 - rolls[0] - 3.5) / 2, 6);

    const sm = await market.sessionMarket(sessionId);
    expect(sm!.games.map((g) => g.status)).toEqual(['settled', 'settled']);
    expect(sm!.activeGameId).toBeNull();
  });

  it('sessionMarket is null outside market sections', async () => {
    const candidate = (await http.post('/api/candidates').set(AUTH).send({ name: 'No Market' }).expect(201)).body as CandidateDetail;
    const other = (await http.post('/api/sessions').set(AUTH).send({ candidateId: candidate.id, section: 'S1' }).expect(201)).body as Session;
    expect(await market.sessionMarket(other.id)).toBeNull();
    expect(await market.candidateMarket(other.id)).toBeNull();
    await http.post(`/api/sessions/${other.id}/start`).set(AUTH).expect(201);
    await http.post(`/api/sessions/${other.id}/market/games`).set(AUTH).send({ questionKey: 'A1' }).expect(400);
  });
});
