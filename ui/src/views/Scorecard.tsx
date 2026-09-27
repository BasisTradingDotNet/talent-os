import { useQueries } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { CandidateDetail, Kit, SectionDef, Session, SessionSummary } from '@contracts/api';
import { api } from '../api/client';
import { qk, useCandidate, useKit, useMe } from '../api/hooks';
import { meanRating, sectionsByStage } from '../lib/summary';
import { fmtDate } from '../lib/time';

export function Scorecard() {
  const { id = '' } = useParams();
  const cand = useCandidate(id);
  const kit = useKit();
  const me = useMe();
  if (cand.isPending || kit.isPending) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (cand.isError || kit.isError) return <p className="p-4 text-sm text-red-700">Could not load: {(cand.error ?? kit.error)?.message}</p>;
  return <Sheet c={cand.data} kit={kit.data} interviewer={me.data?.email ?? ''} />;
}

const ANSWER_MAX = 1000;

function Sheet({ c, kit, interviewer }: { c: CandidateDetail; kit: Kit; interviewer: string }) {
  const sections = sectionsByStage(kit);
  // Full sessions carry the candidate's typed answers (SessionSummary does not).
  const ids = Object.values(c.latest).map((ss) => ss.id);
  const full = useQueries({ queries: ids.map((id) => ({ queryKey: qk.session(id), queryFn: () => api().getSession(id) })) });
  const sessionById = new Map<string, Session>();
  full.forEach((q) => {
    if (q.data) sessionById.set(q.data.id, q.data);
  });
  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-snug text-slate-900 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2">
        <Link className="btn btn-sm" to={`/candidates/${c.id}`}>
          ← Back
        </Link>
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>
      <h1 className="text-lg font-semibold">Candidate scorecard — {kit.jobTitle}</h1>
      <p className="text-slate-600">
        {kit.title} v{kit.version}
      </p>
      <table className="mt-3 w-full">
        <tbody>
          <Row k="Candidate" v={c.name} />
          <Row k="Email / source" v={`${c.email ?? '—'} · ${c.source ?? '—'}`} />
          <Row k="Date" v={fmtDate(new Date().toISOString())} />
          <Row k="Interviewer" v={interviewer || '—'} />
        </tbody>
      </table>

      {sections.map((s) => (
        <SectionBlock key={s.key} s={s} kit={kit} ss={c.latest[s.key]} full={c.latest[s.key] ? sessionById.get(c.latest[s.key].id) : undefined} />
      ))}

      <h2 className="mt-5 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide">Overall</h2>
      <table className="mt-2 w-full">
        <tbody>
          <Row k="Decision" v={c.overallDecision ?? '________________'} />
          <Row k="Level" v={c.level ?? '________________'} />
          <Row k="Comp note" v={c.compNote ?? '________________'} />
          <Row k="Notes" v={c.notes ?? '—'} />
        </tbody>
      </table>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="w-40 py-1 pr-3 text-slate-500">{k}</td>
      <td className="py-1 whitespace-pre-wrap">{v}</td>
    </tr>
  );
}

function SectionBlock({ s, kit, ss, full }: { s: SectionDef; kit: Kit; ss: SessionSummary | undefined; full: Session | undefined }) {
  const answers = full
    ? s.questionKeys
        .map((k) => ({ key: k, r: full.responses.find((r) => r.questionKey === k) }))
        .filter((x) => x.r?.candidateAnswer)
    : [];
  return (
    <div className="mt-5 break-inside-avoid">
      <h2 className="border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide">
        {s.label}
        {ss?.recorded && <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">· recorded</span>}
        {ss && ss.integrityFlags > 0 && <span className="ml-2 font-normal normal-case tracking-normal text-red-700">· {ss.integrityFlags} integrity flags</span>}
      </h2>
      {!ss ? (
        <p className="mt-1 text-slate-400">Not run.</p>
      ) : s.scoring === 'dimensions' ? (
        <table className="mt-2 w-full">
          <tbody>
            {s.dimensionIds.map((d) => {
              const def = kit.dimensions.find((x) => x.id === d);
              const r = ss.ratings.find((x) => x.dimensionId === d);
              return <Row key={d} k={def?.name ?? `Dimension ${d}`} v={r?.rating !== null && r?.rating !== undefined ? `${r.rating} / 5${r.note ? ` — ${r.note}` : ''}` : '__ / 5'} />;
            })}
            <Row k="Mean" v={meanRating(ss.ratings) ?? '—'} />
            <Row k="Recommendation" v={ss.recommendation ?? '—'} />
            <Row k="Status" v={`${ss.status} · ${fmtDate(ss.startedAt ?? ss.createdAt)}`} />
          </tbody>
        </table>
      ) : (
        <table className="mt-2 w-full">
          <tbody>
            {ss.verdict?.subtotals.map((t) => (
              <Row key={t.domain} k={t.label} v={`${t.total} / ${t.max}`} />
            ))}
            <Row k="Total" v={ss.verdict ? `${ss.verdict.total} / ${ss.verdict.max}` : '—'} />
            <Row k="Thresholds" v={s.bands.length ? s.bands.map((b) => `≥ ${b.min} ${b.label}`).join(' · ') : '—'} />
            <Row k="Result" v={ss.verdict?.complete ? ss.verdict.result : `incomplete (${ss.verdict?.scored ?? 0} scored, ${ss.verdict?.skipped ?? 0} skipped)`} />
            <Row k="Traps noticed / bonuses" v={`${ss.trapsNoticed} / ${ss.bonusesGiven}`} />
            <Row k="Status" v={`${ss.status} · ${fmtDate(ss.startedAt ?? ss.createdAt)}`} />
          </tbody>
        </table>
      )}
      {answers.length > 0 && (
        <div className="mt-2" data-testid="scorecard-answers">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Candidate's typed answers</h3>
          <table className="mt-1 w-full">
            <tbody>
              {answers.map(({ key, r }) => {
                const text = r!.candidateAnswer!;
                const score = r!.score !== null ? ` (score ${r!.score})` : '';
                return <Row key={key} k={`${key}${score}`} v={text.length > ANSWER_MAX ? `${text.slice(0, ANSWER_MAX)}… [truncated, ${text.length} chars]` : text} />;
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
