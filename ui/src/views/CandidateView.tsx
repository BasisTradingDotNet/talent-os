/**
 * Public candidate screen, /c/:token. STANDALONE: it renders outside the interviewer layout and
 * calls only the token-gated /api/candidate/:token/* endpoints — everything else sits behind
 * Cloudflare Access.
 *
 * v1: consent → devices (camera + mic, entire screen) → chunked upload while the interviewer
 * drives the session; the candidate types answers here. Nothing is recorded before consent.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import type { CandidateState } from '@contracts/api';
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
      try {
        const state = await api().getCandidateState(token);
        if (cancelled) return;
        setStatus('ok');
        if (versionRef.current !== state.version) apply(state, fetchTime);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setStatus('notfound');
        else setStatus((s) => (s === 'ok' ? 'ok' : 'error'));
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1000);
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
  const timeUp = snap !== null && endsAt !== null && now + snap.offset >= Date.parse(endsAt);

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
        {state.phase === 'intro' && (
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-2xl font-semibold">Before we begin</h2>
            {state.instructions ? (
              <Markdown text={state.instructions} className="text-lg" />
            ) : (
              <p className="text-lg text-slate-700">Your interviewer will present the first question shortly.</p>
            )}
          </div>
        )}
        {state.phase === 'question' && state.question && (
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
            <AnswerBox
              key={`${token}-${state.question.position}`}
              token={token}
              position={state.question.position}
              initial={state.answer?.text ?? ''}
              initialSavedAt={state.answer?.savedAt ?? null}
              locked={timeUp}
            />
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
      const reason = e instanceof ApiError && e.status === 409 ? (e.data as { reason?: string } | undefined)?.reason : undefined;
      if (reason === 'time_up') {
        setStatus('timeup');
      } else {
        if (pending.current === null) pending.current = value;
        setStatus('error');
        retries.current += 1;
        timer.current = window.setTimeout(() => void flush(), Math.min(10_000, 1000 * 2 ** Math.min(retries.current, 4)));
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
