# Make-a-market UI (`ui/src/market/`)

Contract v1.2, `api/src/contracts/api.ts` → "make-a-market". The candidate keeps a two-sided
quote on the table; the interviewer buys at the ask / sells at the bid, reveals a die or a hint,
and settles against the true value. P&L is from the candidate's side.

| File | What |
| --- | --- |
| `api.ts` | `MarketApi` (typed fetchers for the five endpoints), `httpMarketApi`, `marketErrorMessage` (409 reasons → text), `quoteErrorMessage` |
| `MarketConsolePanel.tsx` | Interviewer panel: template picker → start; live quote, buy/sell with size, reveal, settle (inline confirm), blotter, position, fair value, true value + mark-to-true P&L behind a toggle, metrics after settle, history |
| `CandidateMarketPanel.tsx` | Candidate panel: prompt (markdown) + unit, reveals, quote form (bid < ask checked client-side, Enter submits, only sends on submit), own trades, position, settlement |
| `MarketDemo.tsx` | Dev-only page: both panels against an in-memory mock (dice + estimate). Not routed. |
| `shared.ts` | Formatting helpers |

Nothing outside this folder is edited; the panels import only `../api/client` (`ApiError`),
`../components/Markdown` and `../lib/time`.

## Mounting — console (`ui/src/views/Console.tsx`)

Render when the section scores by market. `onSession` receives the full `Session` returned by
every market call; route it through `useSessionMutation` so it lands in the cache in order, sets
`lastMutationAt` (so the 2 s poll never overwrites it with a stale GET) and invalidates the
candidate queries:

```tsx
import { MarketConsolePanel } from '../market/MarketConsolePanel';

// next to the other useSessionMutation hooks — a pass-through that writes the returned Session:
const marketMut = useSessionMutation(session.id, (s: Session) => Promise.resolve(s));

// in the right column (or above the question list), e.g. where DimensionScorecard is rendered:
{section.scoring === 'market' && (
  <MarketConsolePanel session={session} kit={kit} onSession={(s) => marketMut.mutate(s)} />
)}
```

`useSessionMutation` already does `qc.setQueryData(qk.session(id), s)` and invalidates
`qk.candidate(session.candidateId)` and `qk.candidates`. If you wire `onSession` by hand instead,
do the same three things.

The panel needs `session.status === 'live'` to enable **Start game** (the server requires a
live session). Polling (`useSessionPolling`) keeps the candidate's quote fresh ("updated 3 s
ago" uses `session.serverNow`).

## Mounting — candidate page (`ui/src/views/CandidateView.tsx`)

Render when `state.market` is present (the server sets it for market sections only, whether or
not a game has started). `onState` receives the `CandidateState` returned by `PUT …/quote`; feed
it to the same `apply` the poller uses so `version` stays in step:

```tsx
import { CandidateMarketPanel } from '../market/CandidateMarketPanel';

// inside the phase === 'question' (or intro) body, in place of / above the answer box:
{state.market && <CandidateMarketPanel state={state} token={token} onState={(s) => apply(s)} />}
```

The panel shows nothing but `CandidateMarket` fields — no true value, fair value, unrevealed
dice/hints or template config. Brand comes from `state.orgName`. If the section is a market
section but `state.market` is still null the panel renders "Waiting for the interviewer to start
a game…", so mounting on `sectionLabel`/section kind is also fine.

## Queries to invalidate

After any market call the server returns the full `Session`; the console cache key is
`qk.session(session.id)`. Also invalidate `qk.candidate(session.candidateId)` and
`qk.candidates` (profile/list show session summaries). The candidate page has no react-query
cache: it polls `GET /api/candidate/:token/state` every second and applies by `version`.

## Demo / verification

`MarketDemo` is self-contained. Suggested dev-only route (not wired):

```tsx
{import.meta.env.DEV && <Route path="/dev/market" element={<MarketDemo />} />}
```

Or mount it from a scratch entry (`ui/scratch/index.html` + `entry.tsx` rendering `<MarketDemo />`
with `../src/styles.css`) and drive it with Playwright. Test ids: `market-*` (console),
`candidate-*` / `quote-*` (candidate).
