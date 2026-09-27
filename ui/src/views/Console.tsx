import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  Eye,
  EyeOff,
  Play,
  SkipForward,
  Square,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Kit, Question, ResponseRecord, Score, SectionDef, Session, UpdateResponse, Verdict } from '@contracts/api';
import { api } from '../api/client';
import { useKit, useSession, useSessionMutation } from '../api/hooks';
import { CodeBlock } from '../components/CodeBlock';
import { CopyButton } from '../components/CopyButton';
import { DatasetTable } from '../components/DatasetTable';
import { Markdown } from '../components/Markdown';
import { Countdown, Elapsed } from '../components/Timer';
import { serverOffset } from '../lib/time';

export function Console() {
  const { id = '' } = useParams();
  const session = useSession(id);
  const kit = useKit();
  if (session.isPending || kit.isPending) return <p className="p-4 text-sm text-slate-500">Loading session…</p>;
  if (session.isError || kit.isError)
    return <p className="p-4 text-sm text-red-700">Could not load: {(session.error ?? kit.error)?.message}</p>;
  return <ConsoleInner session={session.data} kit={kit.data} />;
}

const EMPTY_RESPONSE = (key: string): ResponseRecord => ({
  questionKey: key,
  score: null,
  notes: '',
  trapNoticed: false,
  bonusGiven: false,
  skipped: false,
  markedForReturn: false,
  timeSpentSeconds: 0,
  updatedAt: '',
  candidateAnswer: null,
  candidateAnswerAt: null,
  firstPresentedAt: null,
});

type Reveal = { modelAnswer: boolean; rubric: boolean; trap: boolean; good: boolean };
const HIDDEN: Reveal = { modelAnswer: false, rubric: false, trap: false, good: false };

function ConsoleInner({ session, kit }: { session: Session; kit: Kit }) {
  const section = kit.sections.find((s) => s.key === session.section);
  const questions = useMemo(
    () =>
      (section?.questionKeys ?? [])
        .map((k) => kit.questions.find((q) => q.key === k))
        .filter((q): q is Question => !!q),
    [section, kit.questions],
  );
  const offset = useMemo(() => serverOffset(session.serverNow, Date.now()), [session.serverNow]);
  const live = session.status === 'live';
  const presentedKey = session.presentedQuestionKey;

  const [selectedOverride, setSelected] = useState<string | null>(null);
  const selectedKey = selectedOverride ?? presentedKey ?? questions[0]?.key ?? null;
  const selected = questions.find((q) => q.key === selectedKey) ?? null;
  const selectedIdx = selected ? questions.indexOf(selected) : -1;

  const [reveal, setReveal] = useState<Reveal>(HIDDEN);
  useEffect(() => setReveal(HIDDEN), [selectedKey]);

  const startMut = useSessionMutation(session.id, () => api().startSession(session.id));
  const endMut = useSessionMutation(session.id, () => api().endSession(session.id));
  const reopenMut = useSessionMutation(session.id, () => api().reopenSession(session.id));
  const presentMut = useSessionMutation(session.id, (key: string | null) => api().presentQuestion(session.id, { questionKey: key }));
  const respMut = useSessionMutation(session.id, (a: { key: string; body: UpdateResponse }) =>
    api().updateResponse(session.id, a.key, a.body),
  );
  const ratingMut = useSessionMutation(session.id, (a: { dim: number; rating?: number | null; note?: string }) =>
    api().updateRating(session.id, a.dim, { rating: a.rating, note: a.note }),
  );
  const patchMut = useSessionMutation(session.id, (body: { setNotes?: string; recommendation?: string | null }) =>
    api().updateSession(session.id, body),
  );

  const present = useCallback(
    (key: string | null) => {
      if (!live) return;
      presentMut.mutate(key);
      setSelected(key);
    },
    [live, presentMut],
  );

  /** Prev/Next follow the presented question while live (the normal flow); otherwise they just select. */
  const step = useCallback(
    (dir: -1 | 1) => {
      const baseKey = live ? presentedKey : selectedKey;
      const baseIdx = baseKey ? questions.findIndex((q) => q.key === baseKey) : -1;
      const nextIdx = baseIdx + dir;
      if (nextIdx < 0 || nextIdx >= questions.length) return;
      const key = questions[nextIdx].key;
      if (live) present(key);
      else setSelected(key);
    },
    [live, presentedKey, selectedKey, questions, present],
  );

  // Stable placeholder for untouched questions so the optimistic scoring panel is not reset each render.
  const emptyResponse = useMemo(() => (selectedKey ? EMPTY_RESPONSE(selectedKey) : null), [selectedKey]);
  const response = selected ? (session.responses.find((r) => r.questionKey === selected.key) ?? emptyResponse) : null;
  const updateResponse = useCallback(
    (key: string, body: UpdateResponse) => respMut.mutate({ key, body }),
    [respMut],
  );
  const toggleScore = useCallback(
    (score: Score) => {
      if (!selected || !response || section?.scoring !== 'rubric') return;
      updateResponse(selected.key, { score: response.score === score ? null : score });
    },
    [selected, response, section, updateResponse],
  );

  // Keyboard: 0–3 score, ←/→ prev/next, unless typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (/^[0-3]$/.test(e.key)) {
        e.preventDefault();
        toggleScore(Number(e.key) as Score);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, toggleScore]);

  if (!section) return <p className="p-4 text-sm text-red-700">Section {session.section} is not in the active kit.</p>;

  const baseIdxForStep = live ? questions.findIndex((q) => q.key === presentedKey) : selectedIdx;
  const canPrev = baseIdxForStep > 0;
  const canNext = baseIdxForStep < questions.length - 1;
  const presentedQ = questions.find((q) => q.key === presentedKey) ?? null;
  const verdict = session.verdict;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <Link to={`/candidates/${session.candidateId}`} className="text-lg font-semibold hover:underline">
              {session.candidateName}
            </Link>
            <span className="mx-2 text-slate-400">·</span>
            <span className="text-base text-slate-700">{section.label}</span>
          </div>
          <StatusChip status={session.status} />
          <div className="flex items-center gap-1 text-sm text-slate-600">
            <span>Elapsed</span>
            <Elapsed since={session.startedAt} until={session.endedAt} offset={offset} />
          </div>
          {verdict && <RunningTotal verdict={verdict} />}
          {verdict?.complete && <ResultChip verdict={verdict} />}
          {presentedQ && presentedQ.timeMinutes !== null && (
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <span>{presentedQ.key}</span>
              <Countdown timeMinutes={presentedQ.timeMinutes} presentedAt={session.presentedAt} offset={offset} />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {session.status === 'ready' && (
              <button className="btn btn-primary" onClick={() => startMut.mutate()} disabled={startMut.isPending} data-testid="start">
                <Play size={14} /> Start
              </button>
            )}
            {session.status === 'live' && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (window.confirm('End this session? The candidate screen will show that this part is complete.')) endMut.mutate();
                }}
                disabled={endMut.isPending}
                data-testid="end"
              >
                <Square size={14} /> End
              </button>
            )}
            {session.status === 'completed' && (
              <button className="btn" onClick={() => reopenMut.mutate()} disabled={reopenMut.isPending}>
                <RotateCcw size={14} /> Reopen
              </button>
            )}
          </div>
        </div>
        {section.candidateView && session.candidateUrl && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Candidate link</span>
            <input className="input w-[28rem] max-w-full font-mono text-xs" readOnly value={session.candidateUrl} data-testid="candidate-url" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={session.candidateUrl} label="Copy" />
            <button className="btn btn-sm" onClick={() => window.open(session.candidateUrl!, '_blank', 'noopener')}>
              <ExternalLink size={14} /> Open candidate view
            </button>
          </div>
        )}
        {(startMut.error || endMut.error || presentMut.error || respMut.error || ratingMut.error || patchMut.error) && (
          <p className="mt-2 text-sm text-red-700">
            {(startMut.error ?? endMut.error ?? presentMut.error ?? respMut.error ?? ratingMut.error ?? patchMut.error)?.message}
          </p>
        )}
      </div>

      {section.interviewerNotes && (
        <details className="card px-4 py-2" open>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Interviewer notes</summary>
          <Markdown text={section.interviewerNotes} className="mt-2 text-sm" />
        </details>
      )}

      <div className="grid grid-cols-[15rem_minmax(0,1fr)_21rem] gap-3">
        {/* Navigator */}
        <nav className="card self-start p-2" aria-label="Questions">
          <ol className="space-y-0.5">
            {questions.map((q, i) => {
              const r = session.responses.find((x) => x.questionKey === q.key);
              const isSel = q.key === selectedKey;
              const isPres = q.key === presentedKey;
              return (
                <li key={q.key}>
                  <button
                    type="button"
                    onClick={() => setSelected(q.key)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                      isSel ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
                    } ${isPres && !isSel ? 'ring-2 ring-emerald-500' : ''}`}
                    data-testid={`nav-${q.key}`}
                  >
                    <NavStatus r={r} rubric={section.scoring === 'rubric'} inverted={isSel} />
                    <span className="w-5 shrink-0 text-xs opacity-70">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs">{q.key}</span> {q.title}
                    </span>
                    {isPres && <span className="chip bg-emerald-100 text-emerald-800">live</span>}
                    {q.timeMinutes !== null && <span className="shrink-0 text-xs opacity-70">{q.timeMinutes}m</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Main panel */}
        <div className="min-w-0 space-y-3">
          <div className="card flex flex-wrap items-center gap-2 px-3 py-2">
            <button className="btn btn-sm" onClick={() => step(-1)} disabled={!canPrev} title="Prev (←)">
              <ChevronLeft size={14} /> Prev
            </button>
            <button className="btn btn-sm" onClick={() => step(1)} disabled={!canNext} title="Next (→)" data-testid="next">
              Next <ChevronRight size={14} />
            </button>
            {live && selected && selectedKey !== presentedKey && (
              <button className="btn btn-sm btn-primary" onClick={() => present(selected.key)} data-testid="present">
                <ArrowRight size={14} /> Present {selected.key}{section.candidateView ? ' to candidate' : ''}
              </button>
            )}
            {live && presentedKey !== null && (
              <button className="btn btn-sm" onClick={() => present(null)}>
                <ArrowLeft size={14} /> Back to intro
              </button>
            )}
            {!live && <span className="text-xs text-slate-500">Session is {session.status}: navigation only selects.</span>}
            {live && presentedKey === null && <span className="text-xs text-slate-500">Candidate is on the intro screen.</span>}
            <span className="ml-auto text-[11px] text-slate-400" title="Shortcuts work when no text field has focus">
              Keys: {section.scoring === 'rubric' ? '0–3 score · ' : ''}←/→ prev/next
            </span>
          </div>

          {live && presentedKey && selectedKey !== presentedKey && (
            <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>
                Candidate is on <strong>{presentedKey}</strong> — you're viewing <strong>{selectedKey}</strong>
              </span>
              <button className="underline" onClick={() => setSelected(presentedKey)}>
                Go to {presentedKey}
              </button>
            </div>
          )}

          {selected ? (
            <QuestionPanel
              q={selected}
              reveal={reveal}
              setReveal={setReveal}
              countdown={
                selected.key === presentedKey && selected.timeMinutes !== null ? (
                  <Countdown timeMinutes={selected.timeMinutes} presentedAt={session.presentedAt} offset={offset} large />
                ) : null
              }
            />
          ) : (
            <p className="card p-4 text-sm text-slate-500">This section has no questions.</p>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-3">
          {selected && response && (
            <ScoringPanel
              key={selected.key}
              q={selected}
              r={response}
              rubric={section.scoring === 'rubric'}
              onChange={(body) => updateResponse(selected.key, body)}
              saving={respMut.isPending}
            />
          )}
          {section.scoring === 'dimensions' && (
            <DimensionScorecard
              kit={kit}
              section={section}
              session={session}
              onRate={(dim, rating) => ratingMut.mutate({ dim, rating })}
              onNote={(dim, note) => ratingMut.mutate({ dim, note })}
              onRecommend={(rec) => patchMut.mutate({ recommendation: rec })}
            />
          )}
          <div className="card p-3">
            <h3 className="mb-1 text-sm font-semibold">Set notes</h3>
            <AutosaveTextarea
              key={`set-${session.id}`}
              value={session.setNotes}
              onSave={(v) => patchMut.mutate({ setNotes: v })}
              placeholder="Ad-hoc follow-ups, observations…"
              rows={5}
              testId="set-notes"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NavStatus({ r, rubric, inverted }: { r: ResponseRecord | undefined; rubric: boolean; inverted: boolean }) {
  const cls = inverted ? 'text-white' : '';
  if (r?.score !== null && r?.score !== undefined && rubric)
    return (
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${inverted ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}`}>
        {r.score}
      </span>
    );
  if (r?.skipped) return <SkipForward size={16} className={`shrink-0 ${cls || 'text-slate-500'}`} />;
  if (r?.markedForReturn) return <Bookmark size={16} className={`shrink-0 ${cls || 'text-amber-600'}`} />;
  if (!rubric && r && (r.notes || r.trapNoticed || r.bonusGiven)) return <Check size={16} className={`shrink-0 ${cls || 'text-emerald-600'}`} />;
  return <Circle size={16} className={`shrink-0 ${cls || 'text-slate-300'}`} />;
}

export function StatusChip({ status }: { status: Session['status'] }) {
  const cls = status === 'live' ? 'bg-emerald-100 text-emerald-800' : status === 'completed' ? 'bg-slate-200 text-slate-700' : 'bg-sky-100 text-sky-800';
  return <span className={`chip ${cls}`}>{status}</span>;
}

export function RunningTotal({ verdict }: { verdict: Verdict }) {
  return (
    <span className="text-sm text-slate-700" data-testid="running-total">
      <strong>
        {verdict.total}/{verdict.max}
      </strong>
      {verdict.subtotals.map((s) => (
        <span key={s.domain}>
          {' · '}
          {s.label} {s.total}/{s.max}
        </span>
      ))}
    </span>
  );
}

export function ResultChip({ verdict }: { verdict: Verdict }) {
  const ok = verdict.band !== null;
  return (
    <span className={`chip ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`} data-testid="result-chip">
      {verdict.result}
    </span>
  );
}

function QuestionPanel({
  q,
  reveal,
  setReveal,
  countdown,
}: {
  q: Question;
  reveal: Reveal;
  setReveal: (r: Reveal) => void;
  countdown: React.ReactNode;
}) {
  const available: { k: keyof Reveal; label: string; present: boolean }[] = [
    { k: 'modelAnswer' as const, label: 'Model answer', present: !!q.modelAnswer },
    { k: 'rubric' as const, label: 'Rubric', present: !!q.rubric },
    { k: 'trap' as const, label: 'Trap / bonus', present: !!q.trapOrBonus },
    { k: 'good' as const, label: 'What good looks like', present: !!q.whatGoodLooksLike },
  ].filter((x) => x.present);
  const allOn = available.length > 0 && available.every((x) => reveal[x.k]);
  const setAll = (v: boolean) => setReveal({ modelAnswer: v, rubric: v, trap: v, good: v });
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            <span className="font-mono text-slate-500">{q.key}</span> · {q.title}
          </h2>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
            <span className="chip bg-slate-100 text-slate-700">{q.domain}</span>
            {q.difficulty && <span className="chip bg-slate-100 text-slate-700">{q.difficulty}</span>}
            <span className="chip bg-slate-100 text-slate-700">{q.mode}</span>
            {q.timeMinutes !== null && <span className="chip bg-slate-100 text-slate-700">{q.timeMinutes} min</span>}
          </div>
        </div>
        {countdown}
      </div>
      <div className="mt-3 space-y-3">
        <Markdown text={q.prompt} className="text-[15px]" />
        {q.dataset && <DatasetTable dataset={q.dataset} />}
        {q.code && <CodeBlock code={q.code} />}
      </div>
      {available.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {available.map((x) => (
              <button
                key={x.k}
                className={`btn btn-sm ${reveal[x.k] ? 'bg-slate-100' : ''}`}
                onClick={() => setReveal({ ...reveal, [x.k]: !reveal[x.k] })}
                data-testid={`reveal-${x.k}`}
              >
                {reveal[x.k] ? <EyeOff size={14} /> : <Eye size={14} />} {x.label}
              </button>
            ))}
            <button className="btn btn-sm ml-auto" onClick={() => setAll(!allOn)} data-testid="reveal-all">
              {allOn ? 'Hide all' : 'Reveal all'}
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {reveal.modelAnswer && q.modelAnswer && (
              <Hidden title="Model answer">
                <Markdown text={q.modelAnswer} className="text-sm" />
              </Hidden>
            )}
            {reveal.rubric && q.rubric && (
              <Hidden title="Rubric">
                <table className="w-full text-sm">
                  <tbody>
                    {(['3', '2', '1', '0'] as const).map((s) => (
                      <tr key={s} className="border-t border-slate-100">
                        <td className="w-8 py-1 pr-2 font-semibold">{s}</td>
                        <td className="py-1">{q.rubric![s]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Hidden>
            )}
            {reveal.trap && q.trapOrBonus && (
              <Hidden title="Trap / bonus">
                <Markdown text={q.trapOrBonus} className="text-sm" />
              </Hidden>
            )}
            {reveal.good && q.whatGoodLooksLike && (
              <Hidden title="What good looks like">
                <Markdown text={q.whatGoodLooksLike} className="text-sm" />
              </Hidden>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Hidden({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3" data-testid="revealed">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">{title}</h4>
      {children}
    </div>
  );
}

function ScoringPanel({
  q,
  r,
  rubric,
  onChange,
  saving,
}: {
  q: Question;
  r: ResponseRecord;
  rubric: boolean;
  onChange: (body: UpdateResponse) => void;
  saving: boolean;
}) {
  const hasTrap = !!q.trapOrBonus;
  // Optimistic: flip immediately, then the full Session from the server replaces it.
  const [local, setLocal] = useState(r);
  useEffect(() => setLocal(r), [r]);
  const change = (body: UpdateResponse) => {
    setLocal((cur) => ({ ...cur, ...body }));
    onChange(body);
  };
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {rubric ? 'Score' : 'Notes'} · {q.key}
        </h3>
        {saving && <span className="text-xs text-slate-400">Saving…</span>}
      </div>
      {rubric && (
        <div className="mb-3 flex gap-1.5" role="group" aria-label="Score">
          {([0, 1, 2, 3] as Score[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn h-10 flex-1 justify-center text-base ${local.score === s ? 'btn-primary' : ''}`}
              onClick={() => change({ score: local.score === s ? null : s })}
              data-testid={`score-${s}`}
              aria-pressed={local.score === s}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <AutosaveTextarea
        key={q.key}
        value={r.notes}
        onSave={(notes) => onChange({ notes })}
        placeholder="Notes for this question…"
        rows={5}
        testId="question-notes"
      />
      <div className={`mt-3 space-y-1.5 rounded-md p-2 text-sm ${hasTrap ? 'border border-amber-300 bg-amber-50' : 'border border-slate-100'}`}>
        {hasTrap && <div className="text-xs font-semibold text-amber-800">This question has a trap / bonus</div>}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={local.trapNoticed} onChange={(e) => change({ trapNoticed: e.target.checked })} data-testid="trap" />
          Trap noticed
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={local.bonusGiven} onChange={(e) => change({ bonusGiven: e.target.checked })} data-testid="bonus" />
          Bonus given
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button className={`btn btn-sm flex-1 justify-center ${local.skipped ? 'bg-slate-200' : ''}`} onClick={() => change({ skipped: !local.skipped })} aria-pressed={local.skipped} data-testid="skip">
          <SkipForward size={14} /> {local.skipped ? 'Skipped' : 'Skip'}
        </button>
        <button
          className={`btn btn-sm flex-1 justify-center ${local.markedForReturn ? 'bg-amber-100 border-amber-300' : ''}`}
          onClick={() => change({ markedForReturn: !local.markedForReturn })}
          aria-pressed={local.markedForReturn}
          data-testid="mark"
        >
          <Bookmark size={14} /> {local.markedForReturn ? 'Marked' : 'Mark for return'}
        </button>
      </div>
      {r.timeSpentSeconds > 0 && <p className="mt-2 text-xs text-slate-500">Time on question so far: {Math.round(r.timeSpentSeconds / 60)} min</p>}
    </div>
  );
}

function DimensionScorecard({
  kit,
  section,
  session,
  onRate,
  onNote,
  onRecommend,
}: {
  kit: Kit;
  section: SectionDef;
  session: Session;
  onRate: (dim: number, rating: number | null) => void;
  onNote: (dim: number, note: string) => void;
  onRecommend: (rec: string | null) => void;
}) {
  return (
    <div className="card p-3" data-testid="scorecard">
      <h3 className="mb-2 text-sm font-semibold">Scorecard (1–5)</h3>
      <div className="space-y-3">
        {section.dimensionIds.map((dimId) => {
          const def = kit.dimensions.find((d) => d.id === dimId);
          const rating = session.ratings.find((x) => x.dimensionId === dimId);
          return (
            <div key={dimId}>
              <div className="mb-1 text-sm">{def?.name ?? `Dimension ${dimId}`}</div>
              <div className="flex gap-1" role="group" aria-label={def?.name}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn btn-sm flex-1 justify-center ${rating?.rating === n ? 'btn-primary' : ''}`}
                    onClick={() => onRate(dimId, rating?.rating === n ? null : n)}
                    aria-pressed={rating?.rating === n}
                    data-testid={`rate-${dimId}-${n}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <AutosaveTextarea
                key={`${session.id}-${dimId}`}
                value={rating?.note ?? ''}
                onSave={(v) => onNote(dimId, v)}
                placeholder="Note…"
                rows={1}
                className="mt-1"
              />
            </div>
          );
        })}
      </div>
      {section.recommendationOptions.length > 0 && (
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium">Recommendation</span>
          <select
            className="input w-full"
            value={session.recommendation ?? ''}
            onChange={(e) => onRecommend(e.target.value === '' ? null : e.target.value)}
            data-testid="recommendation"
          >
            <option value="">— not set —</option>
            {section.recommendationOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Debounced autosave (≈600 ms) with a Saved indicator. Remount (key) when the target changes. */
export function AutosaveTextarea({
  value,
  onSave,
  placeholder,
  rows = 4,
  className = '',
  testId,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  testId?: string;
}) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<'idle' | 'pending' | 'saved'>('idle');
  const dirty = useRef(false);
  const lastSent = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(onSave);
  latest.current = onSave;

  // Follow server updates while the user is not mid-edit, and ignore a stale value carried by
  // another mutation's response while our own save is still in flight.
  useEffect(() => {
    if (dirty.current) return;
    if (lastSent.current === null || value === lastSent.current) setText(value);
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onChange = (v: string) => {
    setText(v);
    dirty.current = true;
    setState('pending');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      dirty.current = false;
      lastSent.current = v;
      latest.current(v);
      setState('saved');
    }, 600);
  };

  return (
    <div className={className}>
      <textarea
        className="input w-full resize-y text-sm"
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (dirty.current) {
            window.clearTimeout(timer.current);
            dirty.current = false;
            lastSent.current = text;
            latest.current(text);
            setState('saved');
          }
        }}
        data-testid={testId}
      />
      <div className="h-4 text-right text-[11px] text-slate-400" data-testid={testId ? `${testId}-state` : undefined}>
        {state === 'pending' ? 'Unsaved…' : state === 'saved' ? 'Saved' : ''}
      </div>
    </div>
  );
}
