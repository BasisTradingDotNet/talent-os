/**
 * Public candidate screen, /c/:token. STANDALONE: it renders outside the interviewer layout and
 * calls only GET /api/candidate/:token/state — everything else sits behind Cloudflare Access.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { CandidateState } from '@contracts/api';
import { api, ApiError } from '../api/client';
import { CodeBlock } from '../components/CodeBlock';
import { DatasetTable } from '../components/DatasetTable';
import { Markdown } from '../components/Markdown';
import { Countdown } from '../components/Timer';
import { serverOffset } from '../lib/time';

interface Snapshot {
  state: CandidateState;
  offset: number;
}

function useCandidateState(token: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const versionRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const fetchTime = Date.now();
      try {
        const state = await api().getCandidateState(token);
        if (cancelled) return;
        setStatus('ok');
        if (versionRef.current !== state.version) {
          versionRef.current = state.version;
          setSnap({ state, offset: serverOffset(state.serverNow, fetchTime) });
        }
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
  }, [token]);

  return { snap, status };
}

export function CandidateView() {
  const { token = '' } = useParams();
  const { snap, status } = useCandidateState(token);

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
  return (
    <Frame orgName={state.orgName} sectionLabel={state.sectionLabel}>
      {state.phase === 'waiting' && <Centered title="Please wait" body="Your interviewer will start shortly." />}
      {state.phase === 'ended' && <Centered title="Thanks — this part is complete." body="" />}
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
        </div>
      )}
    </Frame>
  );
}

function Frame({ orgName, sectionLabel, children }: { orgName?: string; sectionLabel?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold">{orgName ?? ''}</span>
          <span className="text-lg text-slate-600">{sectionLabel ?? ''}</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl py-24 text-center">
      <h2 className="text-3xl font-semibold">{title}</h2>
      {body && <p className="mt-4 text-xl text-slate-600">{body}</p>}
    </div>
  );
}
