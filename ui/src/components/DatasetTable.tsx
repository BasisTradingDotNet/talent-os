import { useMemo } from 'react';
import type { Dataset } from '@contracts/api';
import { csvToTsv, parseCsv } from '../lib/tsv';
import { CopyButton } from './CopyButton';

export function DatasetTable({ dataset, large = false }: { dataset: Dataset; large?: boolean }) {
  const rows = useMemo(() => parseCsv(dataset.text), [dataset.text]);
  const tsv = useMemo(() => csvToTsv(dataset.text), [dataset.text]);
  const [header, ...body] = rows;
  return (
    <div className="card overflow-hidden" data-testid="dataset">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Dataset · {body.length} row{body.length === 1 ? '' : 's'}
        </span>
        <CopyButton text={tsv} label="Copy as TSV" prominent={large} />
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className={`w-full border-collapse ${large ? 'text-base' : 'text-sm'}`}>
          {header && (
            <thead className="sticky top-0 bg-white">
              <tr>
                {header.map((h, i) => (
                  <th key={i} className="border-b border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-700">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-slate-50">
                {r.map((c, j) => (
                  <td key={j} className="whitespace-nowrap border-b border-slate-100 px-3 py-1 font-mono text-[0.95em] tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
