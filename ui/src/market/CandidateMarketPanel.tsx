/**
 * Candidate side of a make-a-market game (contract v1.2). Renders only what CandidateMarket
 * carries — never a true value, fair value, unrevealed dice/hints or the template config. Mount
 * on the candidate page when `state.market` is present — see README.md.
 *
 * Autosave-free: a quote goes to the server only when the candidate submits (button or Enter).
 */
import { useState, type FormEvent } from 'react';
import type { CandidateMarket, CandidateState, QuoteRequest } from '@contracts/api';
import { Markdown } from '../components/Markdown';
import { httpMarketApi, quoteErrorMessage, type MarketApi } from './api';
import { fmtNum, fmtSigned, fmtTime, positionLabel } from './shared';

export interface CandidateMarketPanelProps {
  state: CandidateState;
  token: string;
  onState: (s: CandidateState) => void;
  /** Transport; defaults to the HTTP client. MarketDemo injects an in-memory one. */
  client?: MarketApi;
}

export function CandidateMarketPanel({ state, token, onState, client = httpMarketApi }: CandidateMarketPanelProps) {
  const m = state.market;
  if (!m)
    return (
      <p className="text-xl text-slate-600" data-testid="candidate-market-waiting">
        Waiting for the interviewer to start a game…
      </p>
    );
  const open = m.status === 'open';
  const s = m.settlement;
  return (
    <section className="space-y-6" data-testid="candidate-market">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold">Make a market · Game {m.gameNumber}</h2>
        <span className={`chip text-sm ${open ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`} data-testid="candidate-market-status">
          {open ? 'open' : 'settled'}
        </span>
      </div>

      <Markdown text={m.prompt} className="text-lg" />
      {m.unit && (
        <p className="text-base text-slate-600" data-testid="candidate-market-unit">
          Quote in <strong>{m.unit}</strong>.
        </p>
      )}

      <div>
        <h3 className="mb-2 text-base font-semibold text-slate-700">Revealed so far</h3>
        {m.reveals.length === 0 ? (
          <p className="text-lg text-slate-500" data-testid="candidate-reveals-none">
            Nothing yet.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-2" data-testid="candidate-reveals">
            {m.reveals.map((r, i) => (
              <li key={i} className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xl">
                {r}
              </li>
            ))}
          </ol>
        )}
      </div>

      {open ? (
        <QuoteForm key={m.gameNumber} market={m} token={token} client={client} onState={onState} />
      ) : (
        s && (
          <div className="rounded-md border border-slate-300 bg-slate-50 p-4 text-xl" data-testid="candidate-settlement">
            Settled at <strong className="font-mono">{fmtNum(s.value)}</strong>
            {m.unit ? ` ${m.unit}` : ''}. Your P&amp;L:{' '}
            <strong className={`font-mono ${s.pnl > 0 ? 'text-emerald-700' : s.pnl < 0 ? 'text-red-700' : ''}`} data-testid="candidate-pnl">
              {fmtSigned(s.pnl)}
            </strong>
          </div>
        )
      )}

      <div>
        <h3 className="mb-2 text-base font-semibold text-slate-700">Your trades</h3>
        {m.trades.length === 0 ? (
          <p className="text-lg text-slate-500">None yet.</p>
        ) : (
          <ul className="space-y-1 text-lg" data-testid="candidate-trades">
            {m.trades.map((t, i) => (
              <li key={i}>
                <strong>{t.side === 'you_sold' ? 'You sold' : 'You bought'}</strong> {t.size} @ {fmtNum(t.price)}{' '}
                <span className="text-sm text-slate-500">{fmtTime(t.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-lg">
          Position:{' '}
          <strong className="font-mono" data-testid="candidate-position">
            {positionLabel(m.position)}
          </strong>
        </p>
      </div>
    </section>
  );
}

function QuoteForm({ market, token, client, onState }: { market: CandidateMarket; token: string; client: MarketApi; onState: (s: CandidateState) => void }) {
  const q = market.quote;
  const [bid, setBid] = useState(q ? String(q.bid) : '');
  const [ask, setAsk] = useState(q ? String(q.ask) : '');
  const [size, setSize] = useState(q ? String(q.size) : '1');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = (): QuoteRequest | string => {
    const b = Number(bid);
    const a = Number(ask);
    const n = Number(size);
    if (bid.trim() === '' || !Number.isFinite(b)) return 'Enter a bid.';
    if (ask.trim() === '' || !Number.isFinite(a)) return 'Enter an ask.';
    if (!(b < a)) return 'Your bid must be below your ask.';
    if (size.trim() === '' || !Number.isInteger(n) || n < 1 || n > 100) return 'Size must be a whole number from 1 to 100.';
    return { bid: b, ask: a, size: n };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (typeof v === 'string') {
      setError(v);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onState(await client.putQuote(token, v));
    } catch (err) {
      setError(quoteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-md border border-slate-300 p-4" data-testid="quote-form">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Bid" value={bid} onChange={setBid} testId="quote-bid" autoFocus />
        <Field label="Ask" value={ask} onChange={setAsk} testId="quote-ask" />
        <Field label="Size" value={size} onChange={setSize} testId="quote-size" integer />
        <button type="submit" className="btn btn-primary px-5 py-3 text-lg" disabled={busy} data-testid="quote-submit">
          {busy ? 'Sending…' : q ? 'Update quote' : 'Send quote'}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-500">Press Enter to send. Bid must be below ask. Your quote stays on the table until you change it.</p>
      {error && (
        <p className="mt-2 text-base text-red-700" role="alert" data-testid="quote-error">
          {error}
        </p>
      )}
      <p className="mt-3 text-xl" data-testid="quote-status">
        {q ? (
          <>
            <span className="text-emerald-700">Quote live ✓</span> bid {fmtNum(q.bid)} / ask {fmtNum(q.ask)} × {q.size}
          </>
        ) : (
          <span className="text-slate-500">No quote on the table yet.</span>
        )}
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  testId,
  integer = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  integer?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="input mt-1 block w-32 py-2 font-mono text-2xl tabular-nums"
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? 1 : 'any'}
        min={integer ? 1 : undefined}
        max={integer ? 100 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        data-testid={testId}
      />
    </label>
  );
}
