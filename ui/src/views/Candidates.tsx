import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Flag, Plus, Video } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CandidateSummary, SectionDef, SessionSummary } from '@contracts/api';
import { api, exportUrls } from '../api/client';
import { qk, useCandidates, useKit } from '../api/hooks';
import { fmtScore, meanRating, sectionsByStage } from '../lib/summary';
import { fmtDate } from '../lib/time';
import { ResultChip } from './Console';

export function Candidates() {
  const candidates = useCandidates();
  const kit = useKit();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', source: '', notes: '' });
  const create = useMutation({
    mutationFn: () => api().createCandidate({ name: form.name, email: form.email || undefined, source: form.source || undefined, notes: form.notes || undefined }),
    onSuccess: (c) => {
      qc.setQueryData(qk.candidate(c.id), c);
      void qc.invalidateQueries({ queryKey: qk.candidates });
      setForm({ name: '', email: '', source: '', notes: '' });
      navigate(`/candidates/${c.id}`);
    },
  });
  const sections = kit.data ? sectionsByStage(kit.data) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Candidates</h1>
        <div className="flex gap-2">
          <a className="btn btn-sm" href={exportUrls.candidatesCsv}>
            <Download size={14} /> Export all (CSV)
          </a>
          <Link className="btn btn-sm" to="/settings">
            Settings
          </Link>
        </div>
      </div>

      <form
        className="card flex flex-wrap items-end gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) create.mutate();
        }}
      >
        <label className="text-xs text-slate-600">
          Name
          <input className="input mt-0.5 block w-56" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="new-name" />
        </label>
        <label className="text-xs text-slate-600">
          Email
          <input className="input mt-0.5 block w-56" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="text-xs text-slate-600">
          Source
          <input className="input mt-0.5 block w-40" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="LinkedIn, referral…" />
        </label>
        <label className="text-xs text-slate-600">
          Notes
          <input className="input mt-0.5 block w-72" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={create.isPending} data-testid="create-candidate">
          <Plus size={14} /> Add candidate
        </button>
        {create.error && <span className="text-sm text-red-700">{create.error.message}</span>}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Stage</th>
              {sections.map((s) => (
                <th key={s.key} className="px-3 py-2">
                  {s.label}
                </th>
              ))}
              <th className="px-3 py-2">Decision</th>
            </tr>
          </thead>
          <tbody>
            {candidates.isPending && (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={3 + sections.length}>
                  Loading…
                </td>
              </tr>
            )}
            {candidates.data?.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={3 + sections.length}>
                  No candidates yet.
                </td>
              </tr>
            )}
            {candidates.data?.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link to={`/candidates/${c.id}`} className="font-medium hover:underline" data-testid={`candidate-${c.id}`}>
                    {c.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {c.source ?? '—'} · {fmtDate(c.createdAt)}
                  </div>
                </td>
                <td className="px-3 py-2">{c.stageReached || '—'}</td>
                {sections.map((s) => (
                  <td key={s.key} className="px-3 py-2">
                    <SectionCell c={c} s={s} />
                  </td>
                ))}
                <td className="px-3 py-2">{c.overallDecision ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionCell({ c, s }: { c: CandidateSummary; s: SectionDef }) {
  const ss = c.latest[s.key];
  if (!ss) return <span className="text-slate-300">—</span>;
  if (s.scoring === 'rubric') {
    const v = ss.verdict;
    return (
      <div className="space-y-0.5 text-xs">
        <div className="text-sm font-medium">{v ? `${fmtScore(v.total)}/${v.max}` : '—'}</div>
        {v?.subtotals.map((t) => (
          <div key={t.domain} className="text-slate-600">
            {t.label} {fmtScore(t.total)}/{t.max}
          </div>
        ))}
        <div className="text-slate-600">
          traps {ss.trapsNoticed} · bonuses {ss.bonusesGiven}
        </div>
        <RecordedBadge ss={ss} />
        {v?.complete ? <ResultChip verdict={v} /> : <span className="chip bg-slate-100 text-slate-600">{ss.status}</span>}
      </div>
    );
  }
  const mean = meanRating(ss.ratings);
  return (
    <div className="space-y-0.5 text-xs">
      <div className="text-sm font-medium">{ss.recommendation ?? <span className="text-slate-400">no recommendation</span>}</div>
      <div className="text-slate-600">mean {mean ?? '—'} / 5</div>
      <RecordedBadge ss={ss} />
      <span className="chip bg-slate-100 text-slate-600">{ss.status}</span>
    </div>
  );
}

/** v1: recorded icon + integrity flag count (hidden when neither applies). */
export function RecordedBadge({ ss }: { ss: SessionSummary }) {
  if (!ss.recorded && ss.integrityFlags === 0) return null;
  return (
    <span className="inline-flex items-center gap-2 text-xs" data-testid="recorded-badge">
      {ss.recorded && (
        <span className="inline-flex items-center gap-0.5 text-slate-600" title="Recorded (camera, microphone, screen)">
          <Video size={12} /> rec
        </span>
      )}
      {ss.integrityFlags > 0 && (
        <span className="inline-flex items-center gap-0.5 text-red-700" title="Integrity flags: tab hidden, window blur, paste, share stopped">
          <Flag size={12} /> {ss.integrityFlags}
        </span>
      )}
    </span>
  );
}
