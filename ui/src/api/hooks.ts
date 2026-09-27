import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** Every session mutation returns the full Session: write it straight into the cache. */
export function useSessionMutation<TArgs>(id: string, fn: (args: TArgs) => Promise<Session>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (session) => {
      qc.setQueryData(qk.session(id), session);
      void qc.invalidateQueries({ queryKey: qk.candidate(session.candidateId) });
      void qc.invalidateQueries({ queryKey: qk.candidates });
    },
  });
}
