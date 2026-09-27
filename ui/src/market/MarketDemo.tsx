/**
 * DEV ONLY. Self-contained demo: both market panels against an in-memory mock of the v1.2
 * market endpoints (dice: roll NdS at start, reveal one die per reveal, settle at the total;
 * estimate: a known answer with hints). Nothing here talks to the network.
 *
 * Not wired into the app. Suggested dev-only route (App.tsx):
 *   {import.meta.env.DEV && <Route path="/dev/market" element={<MarketDemo />} />}
 */
import { useMemo, useState } from 'react';
import type { CandidateMarket, CandidateState, Kit, MarketGame, MarketMetrics, MarketQuote, MarketTrade, Question, SectionDef, Session } from '@contracts/api';
import { ApiError } from '../api/client';
import type { MarketApi } from './api';
import { CandidateMarketPanel } from './CandidateMarketPanel';
import { MarketConsolePanel } from './MarketConsolePanel';

// ---- fixture kit --------------------------------------------------------------------------------

const SECTION: SectionDef = {
  key: 'M',
  stage: 2,
  label: 'Set M — Make a market',
  candidateLabel: 'Market making',
  scoring: 'market',
  timeMinutes: 20,
  maxScore: null,
  bands: [],
  dimensionIds: [],
  recommendationOptions: [],
  domainGroups: [],
  candidateView: true,
  showInstructions: false,
  interviewerNotes: null,
  selfPaced: false,
  shuffle: false,
  autoScoring: null,
  candidateInstructions: null,
  questionKeys: ['M1', 'M2'],
};

function question(partial: Pick<Question, 'key' | 'number' | 'title' | 'prompt' | 'market'>): Question {
  return {
    id: `q-${partial.key}`,
    section: 'M',
    stage: 2,
    domain: 'probability',
    difficulty: 'medium',
    mode: 'market',
    timeMinutes: null,
    dataset: null,
    code: null,
    modelAnswer: null,
    rubric: null,
    trapOrBonus: null,
    whatGoodLooksLike: null,
    choices: null,
    correctChoice: null,
    ...partial,
  };
}

const QUESTIONS: Question[] = [
  question({
    key: 'M1',
    number: 1,
    title: 'Sum of three dice',
    prompt: 'I have rolled **three six-sided dice** and hidden them. Make a two-sided market on the **total**. I will reveal one die at a time and may trade against you at any point.',
    market: { kind: 'dice', dice: 3, sides: 6 },
  }),
  question({
    key: 'M2',
    number: 2,
    title: 'Boeing 747s built',
    prompt: 'Make a market on the **total number of Boeing 747s ever built**. I will give you hints as we go and may trade against you at any point.',
    market: {
      kind: 'estimate',
      trueValue: 1574,
      unit: 'aircraft',
      hints: ['Production ran from 1968 to 2023.', 'Peak output was roughly 70 a year around 1990.', 'The 747-400 alone accounted for 694 deliveries.'],
    },
  }),
];

export const DEMO_KIT: Kit = {
  id: 'kit-demo',
  slug: 'demo',
  title: 'Demo kit',
  version: 'demo',
  jobTitle: 'Quant trader',
  candidateInstructions: '',
  dimensions: [],
  sections: [SECTION],
  questions: QUESTIONS,
};

// ---- in-memory engine ---------------------------------------------------------------------------

interface EngineTrade extends MarketTrade {
  /** Index into `quotes` of the quote in force when the trade happened. */
  quoteIndex: number;
}

interface EngineGame {
  id: string;
  q: Question;
  kind: 'dice' | 'estimate';
  status: 'open' | 'settled';
  startedAt: string;
  settledAt: string | null;
  /** dice: rolled values; estimate: []. */
  dice: number[];
  sides: number;
  hints: string[];
  revealed: number;
  quotes: MarketQuote[];
  trades: EngineTrade[];
  cash: number;
  position: number;
  maxAbs: number;
  trueValue: number;
  unit: string | null;
  metrics: MarketMetrics | null;
}

const conflict = (reason: string) => new ApiError(409, reason, { reason });
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class DemoStore {
  games: EngineGame[] = [];
  version = 1;
  private seq = 0;

  reset() {
    this.games = [];
    this.version++;
  }

  private active(): EngineGame | null {
    return this.games.find((g) => g.status === 'open') ?? null;
  }

  private byId(id: string): EngineGame {
    const g = this.games.find((x) => x.id === id);
    if (!g) throw new ApiError(404, 'game not found');
    return g;
  }

  private reveals(g: EngineGame): string[] {
    return g.kind === 'dice' ? g.dice.slice(0, g.revealed).map(String) : g.hints.slice(0, g.revealed);
  }

  private total(g: EngineGame): number {
    return g.kind === 'dice' ? g.dice.length : g.hints.length;
  }

  private fairAt(g: EngineGame, revealed: number): number | null {
    if (g.kind !== 'dice') return null;
    const seen = g.dice.slice(0, revealed).reduce((a, b) => a + b, 0);
    return seen + (g.dice.length - revealed) * ((g.sides + 1) / 2);
  }

  private pnl(g: EngineGame): number {
    return g.cash + g.position * g.trueValue;
  }

  start(questionKey: string) {
    if (this.active()) throw conflict('game_open');
    const q = QUESTIONS.find((x) => x.key === questionKey);
    if (!q || !q.market) throw new ApiError(400, 'not a market question');
    const m = q.market;
    const id = `g${++this.seq}`;
    const dice = m.kind === 'dice' ? Array.from({ length: m.dice }, () => 1 + Math.floor(Math.random() * m.sides)) : [];
    this.games.push({
      id,
      q,
      kind: m.kind,
      status: 'open',
      startedAt: now(),
      settledAt: null,
      dice,
      sides: m.kind === 'dice' ? m.sides : 0,
      hints: m.kind === 'estimate' ? m.hints : [],
      revealed: 0,
      quotes: [],
      trades: [],
      cash: 0,
      position: 0,
      maxAbs: 0,
      trueValue: m.kind === 'dice' ? dice.reduce((a, b) => a + b, 0) : m.trueValue,
      unit: m.kind === 'estimate' ? m.unit : null,
      metrics: null,
    });
    this.version++;
  }

  trade(gameId: string, side: 'buy' | 'sell', size?: number) {
    const g = this.byId(gameId);
    if (g.status !== 'open') throw conflict('not_open');
    const q = g.quotes[g.quotes.length - 1];
    if (!q) throw conflict('no_quote');
    const n = size ?? q.size;
    if (!Number.isInteger(n) || n < 1 || n > q.size) throw new ApiError(400, 'size must be an integer between 1 and the quote size');
    const price = side === 'buy' ? q.ask : q.bid;
    // Candidate's side: the interviewer buying means the candidate sold at the ask.
    if (side === 'buy') {
      g.cash += price * n;
      g.position -= n;
    } else {
      g.cash -= price * n;
      g.position += n;
    }
    g.maxAbs = Math.max(g.maxAbs, Math.abs(g.position));
    g.trades.push({ side, price, size: n, at: now(), quoteIndex: g.quotes.length - 1 });
    this.version++;
  }

  reveal(gameId: string) {
    const g = this.byId(gameId);
    if (g.status !== 'open') throw conflict('not_open');
    if (g.revealed >= this.total(g)) throw conflict('no_reveals');
    g.revealed++;
    this.version++;
  }

  settle(gameId: string) {
    const g = this.byId(gameId);
    if (g.status !== 'open') throw conflict('not_open');
    g.status = 'settled';
    g.settledAt = now();
    g.metrics = this.computeMetrics(g);
    this.version++;
  }

  putQuote(bid: number, ask: number, size: number) {
    const g = this.active();
    if (!g) throw conflict('no_open_game');
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || !(bid < ask) || !Number.isInteger(size) || size < 1 || size > 100)
      throw new ApiError(400, 'bid < ask, both finite, size integer 1–100');
    g.quotes.push({ bid, ask, size, at: now(), revealsSoFar: g.revealed });
    this.version++;
  }

  private computeMetrics(g: EngineGame): MarketMetrics {
    const qs = g.quotes;
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const avgSpread = mean(qs.map((q) => q.ask - q.bid));
    let fairInsideRate: number | null = null;
    let meanMidError: number | null = null;
    if (g.kind === 'dice' && qs.length) {
      const fairs = qs.map((q) => this.fairAt(g, q.revealsSoFar) ?? 0);
      fairInsideRate = qs.filter((q, i) => q.bid <= fairs[i] && fairs[i] <= q.ask).length / qs.length;
      meanMidError = mean(qs.map((q, i) => Math.abs((q.bid + q.ask) / 2 - fairs[i])));
    }
    const followed = g.trades.filter((t) => t.quoteIndex + 1 < qs.length);
    let skewAfterTradeRate: number | null = null;
    if (followed.length) {
      const moved = followed.filter((t) => {
        const before = qs[t.quoteIndex];
        const after = qs[t.quoteIndex + 1];
        const m0 = (before.bid + before.ask) / 2;
        const m1 = (after.bid + after.ask) / 2;
        return t.side === 'buy' ? m1 > m0 : m1 < m0;
      });
      skewAfterTradeRate = moved.length / followed.length;
    }
    return { quotes: qs.length, avgSpread, fairInsideRate, meanMidError, skewAfterTradeRate, pnl: this.pnl(g), maxAbsPosition: g.maxAbs };
  }

  private toGame(g: EngineGame): MarketGame {
    return {
      id: g.id,
      questionKey: g.q.key,
      kind: g.kind,
      status: g.status,
      startedAt: g.startedAt,
      settledAt: g.settledAt,
      reveals: this.reveals(g),
      revealsRemaining: this.total(g) - g.revealed,
      quote: g.quotes[g.quotes.length - 1] ?? null,
      quotes: [...g.quotes],
      trades: g.trades.map(({ side, price, size, at }) => ({ side, price, size, at })),
      position: g.position,
      trueValue: g.trueValue,
      fairValue: this.fairAt(g, g.revealed),
      pnl: this.pnl(g),
      metrics: g.metrics,
    };
  }

  session(): Session {
    const at = now();
    return {
      id: 'demo-session',
      candidateId: 'demo-candidate',
      candidateName: 'Demo Candidate',
      section: SECTION.key,
      kitId: DEMO_KIT.id,
      kitVersion: DEMO_KIT.version,
      status: 'live',
      interviewer: 'demo@example.com',
      createdAt: at,
      startedAt: at,
      endedAt: null,
      presentedQuestionKey: null,
      presentedAt: null,
      candidateUrl: 'http://localhost/c/demo-token',
      setNotes: '',
      recommendation: null,
      responses: [],
      ratings: [],
      verdict: null,
      serverNow: at,
      recording: { required: false, consentAt: null, segments: [] },
      events: [],
      sectionEndsAt: null,
      extensionMinutes: 0,
      questionOrder: null,
      transcript: { status: 'none', model: null, noteModel: null, updatedAt: null, error: null, lines: [] },
      market: { games: this.games.map((g) => this.toGame(g)), activeGameId: this.active()?.id ?? null },
    };
  }

  /** The allowlisted candidate projection: active or last game; nothing the candidate must not see. */
  candidateState(): CandidateState {
    const g = this.active() ?? this.games[this.games.length - 1] ?? null;
    const market: CandidateMarket | null = g
      ? {
          gameNumber: this.games.indexOf(g) + 1,
          prompt: g.q.prompt,
          unit: g.unit,
          reveals: this.reveals(g),
          status: g.status,
          quote: g.quotes.length ? (({ bid, ask, size }) => ({ bid, ask, size }))(g.quotes[g.quotes.length - 1]) : null,
          trades: g.trades.map((t) => ({ side: t.side === 'buy' ? 'you_sold' : 'you_bought', price: t.price, size: t.size, at: t.at })),
          position: g.position,
          settlement: g.status === 'settled' ? { value: g.trueValue, pnl: this.pnl(g) } : null,
        }
      : null;
    return {
      phase: g ? 'question' : 'waiting',
      orgName: 'BTNET',
      sectionLabel: SECTION.candidateLabel,
      instructions: null,
      question: null,
      presentedAt: null,
      serverNow: now(),
      version: this.version,
      recording: { required: false, consentGiven: false, consentText: null },
      answer: null,
      sectionEndsAt: null,
      selfPaced: false,
      answeredPositions: [],
      marking: null,
      market,
    };
  }
}

function mockApi(store: DemoStore, latencyMs = 120): MarketApi {
  return {
    startGame: async (_id, body) => {
      await sleep(latencyMs);
      store.start(body.questionKey);
      return store.session();
    },
    trade: async (_id, gameId, body) => {
      await sleep(latencyMs);
      store.trade(gameId, body.side, body.size);
      return store.session();
    },
    reveal: async (_id, gameId) => {
      await sleep(latencyMs);
      store.reveal(gameId);
      return store.session();
    },
    settle: async (_id, gameId) => {
      await sleep(latencyMs);
      store.settle(gameId);
      return store.session();
    },
    putQuote: async (_token, body) => {
      await sleep(latencyMs);
      store.putQuote(body.bid, body.ask, body.size);
      return store.candidateState();
    },
  };
}

// ---- page ---------------------------------------------------------------------------------------

export function MarketDemo() {
  const store = useMemo(() => new DemoStore(), []);
  const client = useMemo(() => mockApi(store), [store]);
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const session = store.session();
  const candidate = store.candidateState();

  return (
    <div className="min-h-full bg-slate-50 p-4" data-testid="market-demo">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Make-a-market demo</h1>
          <p className="text-xs text-slate-500">
            In-memory mock, dev only. Both panels share one store; in the app the candidate page polls its state every second.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            store.reset();
            bump();
          }}
          data-testid="demo-reset"
        >
          Reset
        </button>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Interviewer console</p>
          <MarketConsolePanel session={session} kit={DEMO_KIT} onSession={bump} client={client} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Candidate page</p>
          <div className="card overflow-hidden" data-testid="demo-candidate-frame">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
              <span className="text-lg font-semibold">{candidate.orgName}</span>
              <span className="text-lg text-slate-600">{candidate.sectionLabel}</span>
            </div>
            <div className="p-4">
              <CandidateMarketPanel state={candidate} token="demo-token" onState={bump} client={client} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
