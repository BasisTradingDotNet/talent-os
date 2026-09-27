import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Session } from '@contracts/api';
import { api } from './client';

export const qk = {
  me: ['me'] as const,
  kit: ['kit'] as const,
  candidates: ['candidates'] as const,
  candidate: (id: string) => ['candidate', id] as const,
  session: (id: string) => ['session', id] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api().getMe(), staleTime: 5 * 60_000 });
}

export function useKit() {
  return useQuery({ queryKey: qk.kit, queryFn: () => api().getKit(), staleTime: 5 * 60_000 });
}

export function useCandidates() {
  return useQuery({ queryKey: qk.candidates, queryFn: () => api().listCandidates() });
}

export function useCandidate(id: string) {
  return useQuery({ queryKey: qk.candidate(id), queryFn: () => api().getCandidate(id), enabled: !!id });
}

export function useSession(id: string) {
  return useQuery({ queryKey: qk.session(id), queryFn: () => api().getSession(id), enabled: !!id, refetchOnWindowFocus: false });
}

/**
 * Session mutations run one at a time per session, so responses arrive in order and the last
 * full Session written to the cache always reflects every earlier change.
 */
const chains = new Map<string, Promise<unknown>>();
function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  chains.set(id, next);
  return next;
}

/** When the last mutation for a session settled: a poll that started earlier must not overwrite it. */
const lastMutationAt = new Map<string, number>();

/** Every session mutation returns the full Session: write it straight into the cache. */
export function useSessionMutation<TArgs>(id: string, fn: (args: TArgs) => Promise<Session>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => enqueue(id, () => fn(args)),
    onSuccess: (session) => {
      qc.setQueryData(qk.session(id), session);
      void qc.invalidateQueries({ queryKey: qk.candidate(session.candidateId) });
      void qc.invalidateQueries({ queryKey: qk.candidates });
    },
    onSettled: () => lastMutationAt.set(id, Date.now()),
  });
}

/**
 * Poll GET /api/sessions/:id every 2 s while the session is ready or live (candidate answers,
 * recording chunks and integrity events arrive from the candidate's browser). A response is
 * applied only when no mutation is in flight and the fetch started after the last one settled,
 * so it never clobbers what the interviewer just changed.
 */
export function useSessionPolling(id: string, enabled: boolean, intervalMs = 2000) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || !id) return;
    let cancelled = false;
    let inflight = false;
    const tick = async () => {
      if (inflight) return;
      inflight = true;
      const started = Date.now();
      try {
        const s = await api().getSession(id);
        if (cancelled) return;
        if (qc.isMutating() === 0 && started > (lastMutationAt.get(id) ?? 0)) qc.setQueryData(qk.session(id), s);
      } catch {
        /* next tick */
      } finally {
        inflight = false;
      }
    };
    const t = window.setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [id, enabled, intervalMs, qc]);
}
