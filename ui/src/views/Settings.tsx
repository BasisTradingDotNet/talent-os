import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Band, SectionDef } from '@contracts/api';
import { api } from '../api/client';
import { qk, useKit } from '../api/hooks';

export function Settings() {
  const kit = useKit();
  if (kit.isPending) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (kit.isError) return <p className="p-4 text-sm text-red-700">Could not load: {kit.error.message}</p>;
  const rubric = kit.data.sections.filter((s) => s.scoring === 'rubric');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="text-sm text-slate-600">
        Thresholds per rubric section. A total at or above a band's minimum earns its label; below every band is "Below threshold". Kit {kit.data.title} v{kit.data.version}.
      </p>
      {rubric.map((s) => (
        <BandsEditor key={`${s.key}-${JSON.stringify(s.bands)}`} s={s} />
      ))}
    </div>
  );
}

function BandsEditor({ s }: { s: SectionDef }) {
  const qc = useQueryClient();
  const [bands, setBands] = useState<Band[]>(s.bands);
  const save = useMutation({
    mutationFn: () => api().putSectionBands(s.key, bands.filter((b) => b.label.trim() !== '').map((b) => ({ min: Number(b.min), label: b.label.trim() }))),
    onSuccess: (kit) => qc.setQueryData(qk.kit, kit),
  });
  return (
    <div className="card p-3">
      <h2 className="text-sm font-semibold">
        {s.label} <span className="font-normal text-slate-500">· max {s.maxScore ?? '—'}</span>
      </h2>
      <table className="mt-2 text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="pr-3 text-left">Min score</th>
            <th className="pr-3 text-left">Label</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => (
            <tr key={i}>
              <td className="py-1 pr-3">
                <input className="input w-20" type="number" min={0} max={s.maxScore ?? undefined} value={b.min} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} />
              </td>
              <td className="py-1 pr-3">
                <input className="input w-72" value={b.label} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              </td>
              <td className="py-1">
                <button className="btn btn-sm" onClick={() => setBands(bands.filter((_, j) => j !== i))} title="Remove">
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2">
        <button className="btn btn-sm" onClick={() => setBands([...bands, { min: 0, label: '' }])}>
          <Plus size={14} /> Add band
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save size={14} /> Save
        </button>
        {save.isSuccess && <span className="text-xs text-emerald-700">Saved</span>}
        {save.error && <span className="text-xs text-red-700">{save.error.message}</span>}
      </div>
    </div>
  );
}
