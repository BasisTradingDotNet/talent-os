/**
 * Interviewer side of a make-a-market game (contract v1.2). Mount in the console when
 * `section.scoring === 'market'` — see README.md. Owns no query state: every call returns the
 * full Session, which is handed back through `onSession`.
 *
 * The true value and the mark-to-true P&L sit behind a toggle while a game is open so the
 * interviewer can trade blind; both show once the game is settled.
 */
import { useMemo, useState } from 'react';
import type { Kit, MarketGame, MarketMetrics, MarketTrade, Question, Session } from '@contracts/api';
import { Markdown } from '../components/Markdown';
import { useTick } from '../lib/time';
import { httpMarketApi, marketErrorMessage, type MarketApi } from './api';
import { fmtAgo, fmtNum, fmtPct, fmtSigned, fmtTime, positionLabel, secondsSince, useServerOffset } from './shared';

export interface MarketConsolePanelProps {
  session: Session;
  kit: Kit;
  onSession: (s: Session) => void;
  /** Transport; defaults to the HTTP client. MarketDemo injects an in-memory one. */
  client?: MarketApi;
}

type Side = 'buy' | 'sell';

export function MarketConsolePanel({ session, kit, onSession, client = httpMarketApi }: MarketConsolePanelProps) {
  const section = kit.sections.find((s) => s.key === session.section);
  const templates = useMemo(() => {
    const keys = section?.questionKeys ?? [];
    return keys.map((k) => kit.questions.find((q) => q.key === k)).filter((q): q is Question => !!q && q.mode === 'market');
  }, [kit, section]);

  const games = session.market?.games ?? [];
  const activeId = session.market?.activeGameId ?? null;
  const active = activeId ? (games.find((g) => g.id === activeId) ?? null) : null;
  const settled = games.filter((g) => g.status === 'settled');
  const focus = active ?? settled[settled.length - 1] ?? null;
  const history = settled.filter((g) => g !== focus).slice().reverse();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (name: string, task: () => Promise<Session>) => {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      onSession(await task());
    } catch (e) {
      setError(marketErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const titleOf = (g: MarketGame) => kit.questions.find((q) => q.key === g.questionKey)?.title ?? g.questionKey;

  return (
    <div className="card p-3" data-testid="market-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Make a market</h3>
        <span className={`chip ${active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`} data-testid="market-status">
          {active ? 'game open' : games.length > 0 ? 'no open game' : 'no game yet'}
        </span>
      </div>
      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-sm text-red-700" data-testid="market-error">
          {error}
        </p>
      )}
      {!active && (
        <TemplatePicker
          templates={templates}
          live={session.status === 'live'}
          busy={busy === 'start'}
          onStart={(key) => run('start', () => client.startGame(session.id, { questionKey: key }))}
        />
      )}
      {focus && (
        <GameView
          key={focus.id}
          game={focus}
          number={games.indexOf(focus) + 1}
          title={titleOf(focus)}
          serverNow={session.serverNow}
          busy={busy}
          onTrade={(side, size) => run(side, () => client.trade(session.id, focus.id, size === undefined ? { side } : { side, size }))}
          onReveal={() => run('reveal', () => client.reveal(session.id, focus.id))}
          onSettle={() => run('settle', () => client.settle(session.id, focus.id))}
        />
      )}
      {history.length > 0 && <History games={history} all={games} titleOf={titleOf} />}
    </div>
  );
}

// ---- template picker ---------------------------------------------------------------------------

function kindLabel(q: Question): string {
  const m = q.market;
  if (!m) return 'market';
  return m.kind === 'dice' ? `dice ${m.dice}d${m.sides}` : `estimate · ${m.unit}`;
}

/** Describes the template without leaking its answer: the estimate's true value stays hidden. */
function kindDetail(q: Question): string {
  const m = q.market;
  if (!m) return 'This question has no market template config.';
  if (m.kind === 'dice') return `Dice: the server rolls ${m.dice}d${m.sides} at start; reveal one die at a time; settles at the total.`;
  const n = m.hints.length;
  return `Estimate in ${m.unit}: ${n} hint${n === 1 ? '' : 's'} to reveal; settles at the known answer (hidden until you show it).`;
}

function TemplatePicker({ templates, live, busy, onStart }: { templates: Question[]; live: boolean; busy: boolean; onStart: (key: string) => void }) {
  const [key, setKey] = useState<string>(templates[0]?.key ?? '');
  const q = templates.find((t) => t.key === key) ?? templates[0] ?? null;
  if (templates.length === 0) return <p className="text-sm text-slate-500">This section has no make-a-market templates (questions with mode “market”).</p>;
  return (
    <div className="mb-3 space-y-2" data-testid="market-picker">
      <div className="flex flex-wrap gap-1.5">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`btn btn-sm ${q?.key === t.key ? 'btn-primary' : ''}`}
            onClick={() => setKey(t.key)}
            data-testid={`market-template-${t.key}`}
          >
            <span>{t.title}</span>
            <span className="opacity-70">· {kindLabel(t)}</span>
          </button>
        ))}
      </div>
      {q && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
          <Markdown text={q.prompt} />
          <p className="mt-1 text-xs text-slate-500">{kindDetail(q)}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={!q || !live || busy} onClick={() => q && onStart(q.key)} data-testid="market-start">
          {busy ? 'Starting…' : 'Start game'}
        </button>
        {!live && <span className="text-xs text-slate-500">Start the session to run a game.</span>}
      </div>
    </div>
  );
}

// ---- one game ----------------------------------------------------------------------------------

function GameView({
  game,
  number,
  title,
  serverNow,
  busy,
  onTrade,
  onReveal,
  onSettle,
}: {
  game: MarketGame;
  number: number;
  title: string;
  serverNow: string;
  busy: string | null;
  onTrade: (side: Side, size: number | undefined) => void;
  onReveal: () => void;
  onSettle: () => void;
}) {
  const open = game.status === 'open';
  const offset = useServerOffset(serverNow);
  const now = useTick(open);
  const [showTrue, setShowTrue] = useState(false);
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [sizeText, setSizeText] = useState('');
  const [sizeError, setSizeError] = useState<string | null>(null);
  const q = game.quote;
  const revealed = showTrue || !open;

  const trade = (side: Side) => {
    if (!q) return;
    let size: number | undefined;
    if (sizeText.trim() !== '') {
      const n = Number(sizeText);
      if (!Number.isInteger(n) || n < 1 || n > q.size) {
        setSizeError(`Size must be a whole number from 1 to ${q.size} (the quote size).`);
        return;
      }
      size = n;
    }
    setSizeError(null);
    onTrade(side, size);
  };

  return (
    <div className="space-y-3" data-testid={`market-game-${game.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            Game {number} · {title}
          </span>
          <span className="chip bg-slate-100 text-slate-700">{game.kind}</span>
          {!open && <span className="chip bg-slate-200 text-slate-700">settled</span>}
        </div>
        <span className="text-xs text-slate-500">{open ? `started ${fmtTime(game.startedAt)}` : `settled ${fmtTime(game.settledAt ?? game.startedAt)}`}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 p-2">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>Candidate’s quote</span>
            <span>
              {game.quotes.length} quote{game.quotes.length === 1 ? '' : 's'} so far
            </span>
          </div>
          {q ? (
            <div data-testid="market-quote">
              <div className="flex flex-wrap items-baseline gap-3 font-mono text-2xl tabular-nums">
                <span>
                  <span className="text-xs text-slate-500">bid </span>
                  <span data-testid="market-quote-bid">{fmtNum(q.bid)}</span>
                </span>
                <span className="text-slate-300">/</span>
                <span>
                  <span className="text-xs text-slate-500">ask </span>
                  <span data-testid="market-quote-ask">{fmtNum(q.ask)}</span>
                </span>
                <span className="text-base text-slate-600">× {q.size}</span>
              </div>
              <p className="text-xs text-slate-500" data-testid="market-quote-meta">
                spread {fmtNum(q.ask - q.bid)} · mid {fmtNum((q.ask + q.bid) / 2)} · updated {fmtAgo(secondsSince(q.at, offset, now))}
                {q.revealsSoFar < game.reveals.length ? ' · made before the last reveal' : ''}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500" data-testid="market-no-quote">
              No quote on the table.
            </p>
          )}
          {open && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  Size
                  <input
                    className="input w-16 text-right"
                    type="number"
                    min={1}
                    max={q?.size ?? undefined}
                    step={1}
                    placeholder={q ? String(q.size) : '—'}
                    value={sizeText}
                    onChange={(e) => setSizeText(e.target.value)}
                    disabled={!q}
                    data-testid="market-size"
                  />
                </label>
                <button type="button" className="btn btn-primary" disabled={!q || !!busy} onClick={() => trade('buy')} data-testid="market-buy">
                  {busy === 'buy' ? 'Buying…' : q ? `Buy at ask ${fmtNum(q.ask)}` : 'Buy at ask'}
                </button>
                <button type="button" className="btn btn-primary" disabled={!q || !!busy} onClick={() => trade('sell')} data-testid="market-sell">
                  {busy === 'sell' ? 'Selling…' : q ? `Sell at bid ${fmtNum(q.bid)}` : 'Sell at bid'}
                </button>
              </div>
              {sizeError && (
                <p className="mt-1 text-xs text-red-700" data-testid="market-size-error">
                  {sizeError}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                <button type="button" className="btn" disabled={game.revealsRemaining === 0 || !!busy} onClick={onReveal} data-testid="market-reveal">
                  {busy === 'reveal' ? 'Revealing…' : `Reveal next (${game.revealsRemaining} left)`}
                </button>
                {confirmSettle ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-xs" data-testid="market-settle-prompt">
                    Settle at the true value and end the game?
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={!!busy}
                      onClick={() => {
                        setConfirmSettle(false);
                        onSettle();
                      }}
                      data-testid="market-settle-confirm"
                    >
                      Confirm settle
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setConfirmSettle(false)} data-testid="market-settle-cancel">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirmSettle(true)} data-testid="market-settle">
                    {busy === 'settle' ? 'Settling…' : 'Settle…'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="rounded-md border border-slate-200 p-2 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">Candidate position</dt>
            <dd className="font-mono tabular-nums" data-testid="market-position">
              {positionLabel(game.position)}
            </dd>
            {game.fairValue !== null && (
              <>
                <dt className="text-slate-500">Fair value (given reveals)</dt>
                <dd className="font-mono tabular-nums" data-testid="market-fair">
                  {fmtNum(game.fairValue)}
                </dd>
              </>
            )}
            <dt className="text-slate-500">True value</dt>
            <dd className="font-mono tabular-nums" data-testid="market-true">
              {revealed ? fmtNum(game.trueValue) : <span className="text-slate-400">hidden</span>}
            </dd>
            <dt className="text-slate-500">Mark-to-true P&amp;L</dt>
            <dd className={`font-mono tabular-nums ${revealed && game.pnl > 0 ? 'text-emerald-700' : revealed && game.pnl < 0 ? 'text-red-700' : ''}`} data-testid="market-pnl">
              {revealed ? fmtSigned(game.pnl) : <span className="text-slate-400">hidden</span>}
            </dd>
          </dl>
          {open && (
            <button type="button" className="btn btn-sm mt-2" onClick={() => setShowTrue((v) => !v)} data-testid="market-toggle-true">
              {showTrue ? 'Hide true value & P&L' : 'Show true value & P&L'}
            </button>
          )}
          <div className="mt-2 border-t border-slate-100 pt-2">
            <p className="mb-1 text-xs text-slate-500">
              Revealed ({game.reveals.length}
              {open ? `, ${game.revealsRemaining} left` : ''})
            </p>
            {game.reveals.length === 0 ? (
              <p className="text-xs text-slate-400">Nothing yet.</p>
            ) : game.kind === 'dice' ? (
              <ol className="flex flex-wrap gap-1" data-testid="market-reveals">
                {game.reveals.map((r, i) => (
                  <li key={i} className="chip bg-slate-900 font-mono text-white">
                    {r}
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="list-decimal space-y-0.5 pl-5" data-testid="market-reveals">
                {game.reveals.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      <Blotter trades={game.trades} />
      {game.metrics && <MetricsCard m={game.metrics} kind={game.kind} />}
    </div>
  );
}

function Blotter({ trades }: { trades: MarketTrade[] }) {
  return (
    <div data-testid="market-blotter">
      <p className="mb-1 text-xs text-slate-500">
        Blotter (your side) · {trades.length} trade{trades.length === 1 ? '' : 's'}
      </p>
      {trades.length === 0 ? (
        <p className="text-xs text-slate-400">No trades yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="font-medium">Time</th>
              <th className="font-medium">You</th>
              <th className="text-right font-medium">Size</th>
              <th className="text-right font-medium">Price</th>
              <th className="font-medium">Candidate</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={i} className="border-t border-slate-100" data-testid="market-trade">
                <td className="font-mono text-xs">{fmtTime(t.at)}</td>
                <td className={t.side === 'buy' ? 'text-emerald-700' : 'text-red-700'}>{t.side === 'buy' ? 'Bought' : 'Sold'}</td>
                <td className="text-right font-mono">{t.size}</td>
                <td className="text-right font-mono">{fmtNum(t.price)}</td>
                <td className="text-xs text-slate-500">{t.side === 'buy' ? 'sold at their ask' : 'bought at their bid'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MetricsCard({ m, kind }: { m: MarketMetrics; kind: MarketGame['kind'] }) {
  const dice = kind === 'dice';
  const cells: [string, string][] = [
    ['P&L (candidate)', fmtSigned(m.pnl)],
    ['Avg spread', fmtNum(m.avgSpread)],
    ['Fair inside', dice ? fmtPct(m.fairInsideRate) : 'n/a'],
    ['Mid error', dice ? (m.meanMidError === null ? '—' : fmtNum(m.meanMidError)) : 'n/a'],
    ['Skew after trade', fmtPct(m.skewAfterTradeRate)],
    ['Max |position|', String(m.maxAbsPosition)],
    ['Quotes', String(m.quotes)],
  ];
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2" data-testid="market-metrics">
      <p className="mb-1 text-xs font-semibold text-emerald-800">Settled — metrics</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="font-mono tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function History({ games, all, titleOf }: { games: MarketGame[]; all: MarketGame[]; titleOf: (g: MarketGame) => string }) {
  return (
    <div className="mt-3 border-t border-slate-200 pt-2" data-testid="market-history">
      <p className="mb-1 text-xs text-slate-500">Previous games</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="font-medium">#</th>
            <th className="font-medium">Template</th>
            <th className="text-right font-medium">Trades</th>
            <th className="text-right font-medium">P&amp;L</th>
            <th className="text-right font-medium">Avg spread</th>
            <th className="text-right font-medium">Fair inside</th>
            <th className="text-right font-medium">Settled</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.id} className="border-t border-slate-100" data-testid="market-history-row">
              <td className="font-mono">{all.indexOf(g) + 1}</td>
              <td>
                {titleOf(g)} <span className="text-xs text-slate-500">· {g.kind}</span>
              </td>
              <td className="text-right font-mono">{g.trades.length}</td>
              <td className={`text-right font-mono ${g.pnl > 0 ? 'text-emerald-700' : g.pnl < 0 ? 'text-red-700' : ''}`}>{fmtSigned(g.metrics?.pnl ?? g.pnl)}</td>
              <td className="text-right font-mono">{g.metrics ? fmtNum(g.metrics.avgSpread) : '—'}</td>
              <td className="text-right font-mono">{g.kind === 'dice' ? fmtPct(g.metrics?.fairInsideRate ?? null) : 'n/a'}</td>
              <td className="text-right font-mono text-xs">{fmtTime(g.settledAt ?? g.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
