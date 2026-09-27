import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CandidateDetail, SectionDef, UpdateCandidate } from '@contracts/api';
import { api, exportUrls } from '../api/client';
import { qk, useCandidate, useKit } from '../api/hooks';
import { meanRating, sectionsByStage, verdictLine } from '../lib/summary';
import { fmtDate } from '../lib/time';
import { AutosaveTextarea, ResultChip, StatusChip } from './Console';

export function CandidateProfile() {
  const { id = '' } = useParams();
  const cand = useCandidate(id);
  const kit = useKit();
  if (cand.isPending || kit.isPending) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (cand.isError || kit.isError) return <p className="p-4 text-sm text-red-700">Could not load: {(cand.error ?? kit.error)?.message}</p>;
  return <Profile c={cand.data} sections={sectionsByStage(kit.data)} decisionOptions={kit.data.sections.find((s) => s.stage === 4)?.recommendationOptions ?? []} />;
}

function Profile({ c, sections, decisionOptions }: { c: CandidateDetail; sections: SectionDef[]; decisionOptions: string[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const patch = useMutation({
    mutationFn: (body: UpdateCandidate) => api().updateCandidate(c.id, body),
    onSuccess: (d) => {
      qc.setQueryData(qk.candidate(c.id), d);
      void qc.invalidateQueries({ queryKey: qk.candidates });
    },
  });
  const start = useMutation({
    mutationFn: (section: string) => api().createSession({ candidateId: c.id, section }),
    onSuccess: (s) => {
      qc.setQueryData(qk.session(s.id), s);
      void qc.invalidateQueries({ queryKey: qk.candidate(c.id) });
      navigate(`/sessions/${s.id}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{c.name}</h1>
        <span className="text-sm text-slate-500">
          {c.email ?? '—'} · {c.source ?? '—'} · added {fmtDate(c.createdAt)} · stage {c.stageReached || '—'}
        </span>
        <div className="ml-auto flex gap-2">
          <Link className="btn btn-sm" to={`/candidates/${c.id}/scorecard`}>
            <FileText size={14} /> Scorecard (print/PDF)
          </Link>
          <a className="btn btn-sm" href={exportUrls.candidateJson(c.id)}>
            <Download size={14} /> Export JSON
          </a>
        </div>
      </div>
      {(patch.error || start.error) && <p className="text-sm text-red-700">{(patch.error ?? start.error)?.message}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_22rem] gap-4">
        <div className="space-y-4">
          <div className="card p-3">
            <h2 className="mb-2 text-sm font-semibold">Run a section</h2>
            <div className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <button key={s.key} className="btn btn-sm" onClick={() => start.mutate(s.key)} disabled={start.isPending} data-testid={`start-${s.key}`}>
                  <Play size={12} /> Start {s.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Starting a section again creates a new session; the old one is kept and marked superseded.</p>
          </div>

          {sections.map((s) => {
            const rows = c.sessions.filter((x) => x.section === s.key);
            return (
              <div key={s.key} className="card p-3">
                <h2 className="mb-2 text-sm font-semibold">{s.label}</h2>
                {rows.length === 0 ? (
                  <p className="text-xs text-slate-400">Not run yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {rows.map((ss) => (
                        <tr key={ss.id} className={`border-t border-slate-100 ${ss.superseded ? 'text-slate-400' : ''}`}>
                          <td className="py-1.5 pr-3">
                            <Link to={`/sessions/${ss.id}`} className="font-medium hover:underline">
                              Open
                            </Link>
                          </td>
                          <td className="py-1.5 pr-3">
                            <StatusChip status={ss.status} />
                          </td>
                          <td className="py-1.5 pr-3">
                            {s.scoring === 'rubric' ? (
                              <span>
                                {verdictLine(ss)} {ss.verdict?.complete && <ResultChip verdict={ss.verdict} />}
                                <span className="ml-2 text-xs text-slate-500">traps {ss.trapsNoticed} · bonuses {ss.bonusesGiven}</span>
                              </span>
                            ) : (
                              <span>
                                {ss.recommendation ?? '—'} <span className="text-xs text-slate-500">mean {meanRating(ss.ratings) ?? '—'}/5</span>
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-xs text-slate-500">{fmtDate(ss.startedAt ?? ss.createdAt)}</td>
                          <td className="py-1.5 text-xs">{ss.superseded && <span className="chip bg-slate-100 text-slate-500">superseded</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>

        <div className="card space-y-3 p-3">
          <h2 className="text-sm font-semibold">Decision</h2>
          <label className="block text-xs text-slate-600">
            Overall decision
            <input
              className="input mt-0.5 block w-full"
              list="decision-options"
              defaultValue={c.overallDecision ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== c.overallDecision) patch.mutate({ overallDecision: v });
              }}
              data-testid="overall-decision"
            />
            <datalist id="decision-options">
              {decisionOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <label className="block text-xs text-slate-600">
            Level
            <input
              className="input mt-0.5 block w-full"
              defaultValue={c.level ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== c.level) patch.mutate({ level: v });
              }}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Comp note
            <input
              className="input mt-0.5 block w-full"
              defaultValue={c.compNote ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== c.compNote) patch.mutate({ compNote: v });
              }}
            />
          </label>
          <div className="text-xs text-slate-600">
            Notes
            <AutosaveTextarea key={c.id} value={c.notes ?? ''} onSave={(v) => patch.mutate({ notes: v || null })} rows={6} className="mt-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
