/**
 * Public candidate screen, /c/:token. STANDALONE: it renders outside the interviewer layout and
 * calls only the token-gated /api/candidate/:token/* endpoints — everything else sits behind
 * Cloudflare Access.
 *
 * v1: consent → devices (camera + mic, entire screen) → chunked upload while the interviewer
 * drives the session; the candidate types answers here. Nothing is recorded before consent.
 * v1.2: multiple-choice questions (choice cards, saved on click) and self-paced sections, where the
 * candidate starts, navigates and submits on their own within the section time limit.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import type { AutoScoring, CandidateState } from '@contracts/api';
import { api, ApiError } from '../api/client';
import { CodeBlock } from '../components/CodeBlock';
import { DatasetTable } from '../components/DatasetTable';
import { Markdown } from '../components/Markdown';
import { Countdown } from '../components/Timer';
import { EventBatcher } from '../lib/integrity';
import { getMediaLayer, NotMonitorError } from '../lib/media';
import { BACKLOG_WARN_BYTES, fmtMb, RecordingController } from '../lib/recording';
import { fmtClock, serverOffset, useTick } from '../lib/time';

interface Snapshot {
  state: CandidateState;
  offset: number;
}

function useCandidateState(token: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const versionRef = useRef<number | null>(null);

  const apply = useCallback((state: CandidateState, fetchTime = Date.now()) => {
    versionRef.current = state.version;
    setSnap({ state, offset: serverOffset(state.serverNow, fetchTime) });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const fetchTime = Date.now();
      let wait = 1000;
      try {
        const state = await api().getCandidateState(token);
        if (cancelled) return;
        setStatus('ok');
        if (versionRef.current !== state.version) apply(state, fetchTime);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setStatus('notfound');
        else setStatus((s) => (s === 'ok' ? 'ok' : 'error'));
        if (e instanceof ApiError && e.status === 429) wait = Math.max(1000, e.retryAfterMs ?? 1000);
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, wait);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [token, apply]);

  return { snap, status, apply };
}

interface Controllers {
  events: EventBatcher;
  rec: RecordingController;
}

export function CandidateView() {
  const { token = '' } = useParams();
  const { snap, status, apply } = useCandidateState(token);

  const ctlRef = useRef<Controllers | null>(null);
  if (!ctlRef.current) {
    const events = new EventBatcher(token, api());
    const rec = new RecordingController(token, api(), getMediaLayer(), (type, detail) => events.push(type, detail));
    ctlRef.current = { events, rec };
  }
  const { events, rec } = ctlRef.current;
  const recSnap = useSyncExternalStore(rec.subscribe, rec.getSnapshot);

  const loadedSent = useRef(false);
  useEffect(() => {
    events.start();
    if (!loadedSent.current) {
      loadedSent.current = true;
      events.push('page_loaded');
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (rec.busy()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      events.stop();
    };
  }, [events, rec]);

  const phase = snap?.state.phase;
  useEffect(() => {
    if (phase === 'ended') void rec.stopAll();
  }, [phase, rec]);

  const endsAt = snap?.state.sectionEndsAt ?? null;
  const now = useTick(endsAt !== null);
  const [serverTimeUp, setServerTimeUp] = useState(false);
  const timeUp = serverTimeUp || (snap !== null && endsAt !== null && now + snap.offset >= Date.parse(endsAt));
  // v1.2: multiple-choice answers are saved per displayed position, optimistically, for the whole session.
  const choices = useChoiceSaver(token, useCallback(() => setServerTimeUp(true), []));
  const refetch = useCallback(async () => {
    try {
      apply(await api().getCandidateState(token));
    } catch {
      /* the poll will catch up */
    }
  }, [apply, token]);

  if (status === 'notfound') {
    return (
      <Frame>
        <Centered title="This link is not valid" body="Please check the link you were sent, or ask your interviewer for a new one." />
      </Frame>
    );
  }
  if (!snap) {
    return (
      <Frame>
        <Centered title={status === 'error' ? 'Connecting…' : 'Loading…'} body={status === 'error' ? 'Trying again shortly.' : ''} />
      </Frame>
    );
  }

  const { state, offset } = snap;
  const required = state.recording.required;
  const media = getMediaLayer();
  let body: React.ReactNode;
  if (state.phase === 'ended') {
    body = <EndedScreen recorded={recSnap.stopping || recSnap.finished || recSnap.pendingChunks > 0} finished={recSnap.finished} pendingBytes={recSnap.pendingBytes} />;
  } else if (required && !media.supported()) {
    body = <Centered title="Please open this link in Chrome or Edge on a laptop or desktop." body="This test records your camera, microphone and screen, which needs a desktop browser." />;
  } else if (required && !state.recording.consentGiven) {
    body = <ConsentScreen text={state.recording.consentText ?? ''} onAccept={async () => apply(await api().postConsent(token))} />;
  } else if (required && !recSnap.recording) {
    body = <DeviceSetup rec={rec} snapshot={recSnap} />;
  } else {
    body = (
      <>
        {state.phase === 'waiting' && <Centered title="Please wait" body="Your interviewer will start shortly." />}
        {state.phase === 'intro' && state.selfPaced && (
          <SelfPacedIntro
            instructions={state.instructions}
            marking={state.marking}
            onStart={async () => {
              try {
                apply(await api().startTest(token));
              } catch (e) {
                if (e instanceof ApiError && e.status === 409 && (e.reason === 'consent_required' || e.reason === 'devices_required')) {
                  await refetch();
                  throw new Error(e.reason === 'consent_required' ? 'Please accept the recording notice first.' : 'Your camera and screen recording has not started yet — please wait a moment and try again.');
                }
                throw e;
              }
            }}
          />
        )}
        {state.phase === 'intro' && !state.selfPaced && (
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-2xl font-semibold">Before we begin</h2>
            {state.instructions ? (
              <Markdown text={state.instructions} className="text-lg" />
            ) : (
              <p className="text-lg text-slate-700">Your interviewer will present the first question shortly.</p>
            )}
          </div>
        )}
        {state.phase === 'question' && state.question && state.selfPaced && (
          <SelfPacedScreen
            token={token}
            state={state}
            choices={choices}
            locked={timeUp}
            apply={apply}
          />
        )}
        {state.phase === 'question' && state.question && !state.selfPaced && (
          <div className="mx-auto max-w-4xl space-y-6" data-testid="question">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-semibold text-slate-600">
                Question {state.question.position} of {state.question.total}
              </h2>
              <Countdown timeMinutes={state.question.timeMinutes} presentedAt={state.presentedAt} offset={offset} large />
            </div>
            <Markdown text={state.question.prompt} className="text-xl leading-relaxed" />
            {state.question.dataset && <DatasetTable dataset={state.question.dataset} large />}
            {state.question.code && <CodeBlock code={state.question.code} large />}
            {state.question.choices ? (
              <ChoiceList
                options={state.question.choices}
                value={choices.valueFor(state.question.position, state.answer?.choice ?? null)}
                onChange={(c) => choices.set(state.question!.position, c)}
                locked={timeUp}
                status={choices.status}
              />
            ) : (
              <AnswerBox
                key={`${token}-${state.question.position}`}
                token={token}
                position={state.question.position}
                initial={state.answer?.text ?? ''}
                initialSavedAt={state.answer?.savedAt ?? null}
                locked={timeUp}
              />
            )}
          </div>
        )}
      </>
    );
  }

  const overlayKind = state.phase !== 'ended' && recSnap.recording ? (recSnap.screen === 'stopped' ? 'screen' : recSnap.camera === 'stopped' ? 'camera' : null) : null;

  return (
    <Frame orgName={state.orgName} sectionLabel={state.sectionLabel} endsAt={state.phase === 'ended' ? null : endsAt} offset={offset}>
      {body}
      {overlayKind && <StoppedOverlay kind={overlayKind} rec={rec} />}
      {(recSnap.recording || recSnap.stopping || (recSnap.finished && state.phase !== 'ended')) && <RecordingPill rec={rec} snapshot={recSnap} />}
    </Frame>
  );
}

// ---- consent + devices -------------------------------------------------------------------------

function ConsentScreen({ text, onAccept }: { text: string; onAccept: () => Promise<void> }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-3xl" data-testid="consent">
      <h2 className="mb-4 text-2xl font-semibold">Before we begin: recording notice</h2>
      <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-base leading-relaxed text-slate-800" data-testid="consent-text">
        {text}
      </div>
      <label className="mt-4 flex items-center gap-2 text-lg">
        <input type="checkbox" className="h-5 w-5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="consent-agree" />
        I agree
      </label>
      <button
        className="btn btn-primary mt-4 px-4 py-2 text-base"
        disabled={!agreed || busy}
        data-testid="consent-continue"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onAccept();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save your consent — please try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Continue
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function DeviceSetup({ rec, snapshot }: { rec: RecordingController; snapshot: ReturnType<RecordingController['getSnapshot']> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'camera' | 'screen' | null>(null);
  const capture = async (kind: 'camera' | 'screen') => {
    setBusy(kind);
    setError(null);
    try {
      await rec.capture(kind);
    } catch (e) {
      if (e instanceof NotMonitorError) setError('Please choose Entire screen (not a window or a tab), then try again.');
      else if (e instanceof DOMException && e.name === 'NotAllowedError') setError(kind === 'camera' ? 'Camera and microphone access was blocked. Please allow it and try again.' : 'Screen sharing was cancelled. Please choose Entire screen.');
      else setError(e instanceof Error ? e.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(null);
    }
  };
  const cameraOn = snapshot.camera === 'live';
  const screenOn = snapshot.screen === 'live';
  return (
    <div className="mx-auto max-w-3xl" data-testid="devices">
      <h2 className="mb-2 text-2xl font-semibold">Set up recording</h2>
      <p className="mb-6 text-lg text-slate-700">Both steps are needed before the test can start. Keep this tab open for the whole test.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h3 className="text-lg font-semibold">1. Camera and microphone</h3>
          {cameraOn ? (
            <div className="mt-3">
              <StreamVideo stream={rec.cameraStream()} className="aspect-video w-full rounded-md bg-slate-900" />
              <p className="mt-2 text-sm text-emerald-700">Camera and microphone are on.</p>
            </div>
          ) : (
            <button className="btn btn-primary mt-3 px-4 py-2 text-base" onClick={() => capture('camera')} disabled={busy !== null} data-testid="camera-on">
              Turn on camera and microphone
            </button>
          )}
        </div>
        <div className="card p-4">
          <h3 className="text-lg font-semibold">2. Entire screen</h3>
          {screenOn ? (
            <p className="mt-3 text-sm text-emerald-700">Your entire screen is being shared.</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-600">In the dialog, pick <strong>Entire screen</strong> — not a window or a tab.</p>
              <button className="btn btn-primary mt-3 px-4 py-2 text-base" onClick={() => capture('screen')} disabled={busy !== null} data-testid="screen-share">
                Share your entire screen
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-4 text-base text-red-700" data-testid="device-error">
          {error}
        </p>
      )}
      {cameraOn && screenOn && !snapshot.recording && <p className="mt-4 text-base text-slate-600">Starting the recording…</p>}
    </div>
  );
}

function StoppedOverlay({ kind, rec }: { kind: 'screen' | 'camera'; rec: RecordingController }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/70 p-6" data-testid={`overlay-${kind}`}>
      <div className="card max-w-lg p-6 text-center">
        <h2 className="text-2xl font-semibold">{kind === 'screen' ? 'Screen sharing stopped' : 'Camera stopped'}</h2>
        <p className="mt-2 text-base text-slate-700">
          {kind === 'screen' ? 'The test is recorded, so please share your entire screen again to continue.' : 'Please turn your camera and microphone back on to continue.'}
        </p>
        <button
          className="btn btn-primary mt-4 px-4 py-2 text-base"
          disabled={busy}
          data-testid={`reshare-${kind}`}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await rec.capture(kind);
            } catch (e) {
              setError(e instanceof NotMonitorError ? 'Please choose Entire screen.' : e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {kind === 'screen' ? 'Share your entire screen' : 'Turn on camera and microphone'}
        </button>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}

function RecordingPill({ rec, snapshot }: { rec: RecordingController; snapshot: ReturnType<RecordingController['getSnapshot']> }) {
  const stream = rec.cameraStream();
  const upToDate = snapshot.pendingBytes === 0;
  return (
    <div className="fixed bottom-4 right-4 z-30 flex items-center gap-3 rounded-full border border-slate-300 bg-white/95 py-1.5 pl-3 pr-2 text-sm shadow-lg" data-testid="rec-pill">
      <span className="flex items-center gap-1.5 font-semibold text-red-600">
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" /> REC
      </span>
      <span className={upToDate ? 'text-slate-600' : 'text-amber-700'} data-testid="upload-status">
        {snapshot.pendingBytes > BACKLOG_WARN_BYTES ? `Upload backlog ${fmtMb(snapshot.pendingBytes)} — check your connection` : upToDate ? 'uploads up to date' : `${fmtMb(snapshot.pendingBytes)} waiting`}
      </span>
      {stream && <StreamVideo stream={stream} className="h-10 w-16 rounded-md bg-slate-900 object-cover" />}
    </div>
  );
}

function StreamVideo({ stream, className }: { stream: MediaStream | null; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay muted playsInline className={className} />;
}

function EndedScreen({ recorded, finished, pendingBytes }: { recorded: boolean; finished: boolean; pendingBytes: number }) {
  if (recorded && !finished) {
    return (
      <Centered title="Finishing upload… keep this tab open" body={`${fmtMb(pendingBytes)} left`} testId="finishing" />
    );
  }
  return <Centered title="All done — you can close this tab." body="Thanks — this part is complete." testId="all-done" />;
}

// ---- answer box ---------------------------------------------------------------------------------

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'timeup';

function AnswerBox({
  token,
  position,
  initial,
  initialSavedAt,
  locked,
}: {
  token: string;
  position: number;
  initial: string;
  initialSavedAt: string | null;
  locked: boolean;
}) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>(initialSavedAt ? 'saved' : 'idle');
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt);
  const pending = useRef<string | null>(null);
  const inflight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const retries = useRef(0);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (pending.current === null || inflight.current) return;
    const value = pending.current;
    pending.current = null;
    inflight.current = true;
    setStatus('saving');
    try {
      const r = await api().saveAnswer(token, { position, text: value });
      retries.current = 0;
      setSavedAt(r.savedAt);
      setStatus('saved');
    } catch (e) {
      const api409 = e instanceof ApiError && e.status === 409;
      if (api409 && e.reason === 'time_up') {
        setStatus('timeup');
      } else {
        if (pending.current === null) pending.current = value;
        setStatus('error');
        retries.current += 1;
        // 429: wait out Retry-After. Other 409s (not_live, not_presented, consent_required) will not
        // succeed by themselves: keep the text pending and retry on the next edit or blur only.
        if (e instanceof ApiError && e.status === 429) timer.current = window.setTimeout(() => void flush(), Math.max(500, e.retryAfterMs ?? 1000));
        else if (!api409) timer.current = window.setTimeout(() => void flush(), Math.min(10_000, 1000 * 2 ** Math.min(retries.current, 4)));
      }
    } finally {
      inflight.current = false;
      if (pending.current !== null && retries.current === 0) void flush();
    }
  }, [token, position]);

  const onChange = (v: string) => {
    setText(v);
    pending.current = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  };

  // Time's up: push whatever is pending straight away, then the box is read-only.
  useEffect(() => {
    if (locked) void flush();
  }, [locked, flush]);

  // Leaving this question (or the page): flush the pending save for THIS position first — the
  // server accepts earlier-presented positions.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current !== null) void api().saveAnswer(token, { position, text: pending.current }).catch(() => undefined);
    },
    [token, position],
  );

  const saveLabel =
    status === 'saving' ? 'Saving…' : status === 'saved' ? `Saved ✓ ${savedAt ? new Date(savedAt).toLocaleTimeString() : ''}` : status === 'error' ? 'Not saved — retrying' : status === 'timeup' ? "Time's up — your answers are saved." : '';

  return (
    <div className="border-t border-slate-200 pt-5" data-testid="answer">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="answer-text" className="text-lg font-semibold">
          Your answer
        </label>
        <span className={`text-sm ${status === 'error' ? 'text-red-700' : 'text-slate-500'}`} data-testid="answer-status">
          {locked && status !== 'saving' ? "Time's up — your answers are saved." : saveLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">Work in your own spreadsheet as usual — type your final numbers and reasoning here.</p>
      <textarea
        id="answer-text"
        className={`input mt-2 w-full resize-y text-base leading-relaxed ${locked ? 'bg-slate-100 text-slate-600' : ''}`}
        rows={8}
        value={text}
        readOnly={locked}
        maxLength={20_000}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void flush()}
        data-testid="answer-text"
      />
      {locked && (
        <p className="mt-1 text-sm font-medium text-red-700" data-testid="time-up">
          Time's up — your answers are saved.
        </p>
      )}
    </div>
  );
}

// ---- v1.2: multiple choice + self-paced ---------------------------------------------------------

const fmtPts = (n: number) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(-n)}` : '0');
const fmtNum = (n: number) => (n === 0.25 ? '¼' : n === 0.5 ? '½' : n === 0.75 ? '¾' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

export function markingLine(m: AutoScoring): string {
  return `Correct ${fmtPts(m.correct)} · Wrong ${fmtPts(m.wrong)} · Blank ${fmtPts(m.blank)}`;
}

/** Saves choices immediately (optimistic), one request at a time, with backoff / Retry-After. */
function useChoiceSaver(token: string, onTimeUp: () => void) {
  const [local, setLocal] = useState<Record<number, number | null>>({});
  const [status, setStatus] = useState<SaveStatus>('idle');
  const queue = useRef<Map<number, number | null>>(new Map());
  const inflight = useRef(false);
  const retries = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inflight.current || queue.current.size === 0) return;
    const [position, choice] = queue.current.entries().next().value as [number, number | null];
    queue.current.delete(position);
    inflight.current = true;
    setStatus('saving');
    try {
      await api().saveChoice(token, { position, choice });
      retries.current = 0;
      setStatus('saved');
    } catch (e) {
      const api409 = e instanceof ApiError && e.status === 409;
      if (api409 && e.reason === 'time_up') {
        queue.current.clear();
        setStatus('timeup');
        onTimeUp();
      } else if (api409) {
        // not_live / not_presented will not succeed by themselves: keep the local value, report it.
        setStatus('error');
      } else {
        if (!queue.current.has(position)) queue.current.set(position, choice);
        setStatus('error');
        retries.current += 1;
        const wait = e instanceof ApiError && e.status === 429 ? Math.max(500, e.retryAfterMs ?? 1000) : Math.min(10_000, 1000 * 2 ** Math.min(retries.current, 4));
        timer.current = window.setTimeout(() => void flush(), wait);
      }
    } finally {
      inflight.current = false;
      if (queue.current.size > 0 && retries.current === 0) void flush();
    }
  }, [token, onTimeUp]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const set = useCallback(
    (position: number, choice: number | null) => {
      setLocal((l) => ({ ...l, [position]: choice }));
      queue.current.set(position, choice);
      void flush();
    },
    [flush],
  );
  const valueFor = useCallback((position: number, server: number | null) => (position in local ? local[position] : server), [local]);
  const answered = useCallback(
    (serverPositions: number[]) => {
      const set = new Set(serverPositions);
      for (const [p, c] of Object.entries(local)) {
        if (c === null) set.delete(Number(p));
        else set.add(Number(p));
      }
      return set;
    },
    [local],
  );
  return { local, status, set, valueFor, answered };
}
type ChoiceSaver = ReturnType<typeof useChoiceSaver>;

function ChoiceList({
  options,
  value,
  onChange,
  locked,
  status,
}: {
  options: string[];
  value: number | null;
  onChange: (c: number | null) => void;
  locked: boolean;
  status: SaveStatus;
}) {
  const saveLabel = locked ? "Time's up — your answers are saved." : status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : status === 'error' ? 'Not saved — retrying' : '';
  return (
    <div className="border-t border-slate-200 pt-5" data-testid="choices">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-lg font-semibold">Your answer</span>
        <span className={`text-sm ${status === 'error' && !locked ? 'text-red-700' : 'text-slate-500'}`} data-testid="answer-status">
          {saveLabel}
        </span>
      </div>
      <div role="radiogroup" className="mt-3 grid gap-3">
        {options.map((opt, i) => {
          const on = value === i;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={locked}
              onClick={() => !locked && onChange(on ? i : i)}
              className={`flex w-full items-start gap-4 rounded-lg border-2 px-4 py-3 text-left text-lg transition ${
                on ? 'border-slate-900 bg-slate-100 ring-2 ring-slate-900' : 'border-slate-300 bg-white hover:border-slate-500'
              } ${locked ? 'cursor-default opacity-80' : ''}`}
              data-testid={`choice-${i}`}
            >
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-400 text-slate-600'}`}>
                {String.fromCharCode(65 + i)}
              </span>
              <Markdown text={opt} className="min-w-0 flex-1 text-lg" />
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn text-sm" disabled={locked || value === null} onClick={() => onChange(null)} data-testid="clear-answer">
          Clear answer
        </button>
        {locked && (
          <p className="text-sm font-medium text-red-700" data-testid="time-up">
            Time's up — your answers are saved.
          </p>
        )}
      </div>
    </div>
  );
}

function SelfPacedIntro({ instructions, marking, onStart }: { instructions: string | null; marking: AutoScoring | null; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-3xl" data-testid="self-paced-intro">
      <h2 className="mb-4 text-2xl font-semibold">Before you start</h2>
      {instructions && <Markdown text={instructions} className="text-lg" />}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {marking && (
          <div className="card p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Marking</h3>
            <p className="mt-1 text-lg" data-testid="marking">
              {markingLine(marking)}
            </p>
          </div>
        )}
        <div className="card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Time limit</h3>
          <p className="mt-1 text-lg">The clock starts when you press Start; the countdown stays at the top of the page. Your answers are saved as you go and submitted when time runs out.</p>
        </div>
      </div>
      <button
        className="btn btn-primary mt-6 px-5 py-2.5 text-lg"
        disabled={busy}
        data-testid="start-test"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onStart();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not start — please try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Start test
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-700" data-testid="start-error">
          {error}
        </p>
      )}
    </div>
  );
}

function SelfPacedScreen({
  token,
  state,
  choices,
  locked,
  apply,
}: {
  token: string;
  state: CandidateState;
  choices: ChoiceSaver;
  locked: boolean;
  apply: (s: CandidateState) => void;
}) {
  const q = state.question!;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answered = choices.answered(state.answeredPositions);
  const unanswered = q.total - answered.size;
  const go = async (position: number) => {
    if (busy || position < 1 || position > q.total || position === q.position) return;
    setBusy(true);
    setError(null);
    try {
      apply(await api().navigate(token, { position }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move — please try again.');
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await api().submitTest(token));
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit — please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]" data-testid="question">
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-slate-600" data-testid="question-heading">
          Question {q.position} of {q.total}
        </h2>
        <Markdown text={q.prompt} className="text-xl leading-relaxed" />
        {q.dataset && <DatasetTable dataset={q.dataset} large />}
        {q.code && <CodeBlock code={q.code} large />}
        {q.choices ? (
          <ChoiceList options={q.choices} value={choices.valueFor(q.position, state.answer?.choice ?? null)} onChange={(c) => choices.set(q.position, c)} locked={locked} status={choices.status} />
        ) : (
          <AnswerBox key={`${token}-${q.position}`} token={token} position={q.position} initial={state.answer?.text ?? ''} initialSavedAt={state.answer?.savedAt ?? null} locked={locked} />
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <button type="button" className="btn px-4 py-2 text-base" disabled={busy || q.position <= 1} onClick={() => go(q.position - 1)} data-testid="prev">
            ← Previous
          </button>
          <button type="button" className="btn px-4 py-2 text-base" disabled={busy || q.position >= q.total} onClick={() => go(q.position + 1)} data-testid="next">
            Next →
          </button>
          <button type="button" className="btn btn-primary ml-auto px-4 py-2 text-base" disabled={busy} onClick={() => setConfirm(true)} data-testid="submit-test">
            Submit test
          </button>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
      <aside className="card self-start p-3" aria-label="Questions">
        <h3 className="mb-2 text-sm font-semibold text-slate-600">
          {answered.size} of {q.total} answered
        </h3>
        <ol className="grid grid-cols-5 gap-1.5" data-testid="navigator">
          {Array.from({ length: q.total }, (_, i) => i + 1).map((p) => {
            const isCur = p === q.position;
            const isAns = answered.has(p);
            return (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => go(p)}
                  disabled={busy}
                  aria-current={isCur ? 'true' : undefined}
                  className={`flex h-9 w-full items-center justify-center rounded-md border text-sm font-semibold ${
                    isCur ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-300'
                  } ${isAns ? 'bg-emerald-100 text-emerald-900' : 'bg-white text-slate-600'}`}
                  data-testid={`nav-${p}`}
                  data-answered={isAns ? '1' : '0'}
                >
                  {p}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-slate-500">Green = answered. Answers save as you click.</p>
      </aside>
      {confirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/70 p-6" data-testid="submit-dialog">
          <div className="card max-w-md p-6">
            <h2 className="text-2xl font-semibold">Submit your test?</h2>
            <p className="mt-2 text-base text-slate-700" data-testid="submit-summary">
              {unanswered === 0 ? 'You have answered every question.' : `${unanswered} of ${q.total} question${q.total === 1 ? '' : 's'} ${unanswered === 1 ? 'is' : 'are'} unanswered.`} Once submitted you cannot change your answers.
            </p>
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn px-4 py-2 text-base" disabled={busy} onClick={() => setConfirm(false)} data-testid="submit-cancel">
                Keep working
              </button>
              <button type="button" className="btn btn-primary px-4 py-2 text-base" disabled={busy} onClick={() => void submit()} data-testid="submit-confirm">
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- frame --------------------------------------------------------------------------------------

function SectionCountdown({ endsAt, offset }: { endsAt: string; offset: number }) {
  const now = useTick(true);
  const remaining = (Date.parse(endsAt) - (now + offset)) / 1000;
  if (remaining <= 0) {
    return (
      <span className="font-mono text-2xl font-semibold tabular-nums text-red-600" data-testid="section-countdown" data-over="1">
        Time's up +{fmtClock(-remaining)}
      </span>
    );
  }
  const warn = remaining < 5 * 60;
  return (
    <span className={`font-mono text-2xl font-semibold tabular-nums ${warn ? 'text-amber-600' : 'text-slate-800'}`} data-testid="section-countdown" data-over="0">
      {fmtClock(remaining)} left
    </span>
  );
}

function Frame({
  orgName,
  sectionLabel,
  endsAt,
  offset = 0,
  children,
}: {
  orgName?: string;
  sectionLabel?: string;
  endsAt?: string | null;
  offset?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-white text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <span className="text-lg font-semibold">{orgName ?? ''}</span>
          {endsAt && <SectionCountdown endsAt={endsAt} offset={offset} />}
          <span className="text-lg text-slate-600">{sectionLabel ?? ''}</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

function Centered({ title, body, testId }: { title: string; body: string; testId?: string }) {
  return (
    <div className="mx-auto max-w-xl py-24 text-center" data-testid={testId}>
      <h2 className="text-3xl font-semibold">{title}</h2>
      {body && <p className="mt-4 text-xl text-slate-600">{body}</p>}
    </div>
  );
}
