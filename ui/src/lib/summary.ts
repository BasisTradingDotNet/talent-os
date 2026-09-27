import type { DimensionRating, Kit, SectionDef, SessionSummary } from '@contracts/api';

export function meanRating(ratings: DimensionRating[]): number | null {
  const vals = ratings.map((r) => r.rating).filter((r): r is number => r !== null);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

export function sectionsByStage(kit: Kit): SectionDef[] {
  return [...kit.sections].sort((a, b) => a.stage - b.stage || kit.sections.indexOf(a) - kit.sections.indexOf(b));
}

/** v1.2: auto-scored totals may be fractional (negative marking) — up to 2 decimals, e.g. 13.75. */
export function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export function verdictLine(s: SessionSummary | undefined): string {
  if (!s?.verdict) return '—';
  const v = s.verdict;
  return `${fmtScore(v.total)}/${v.max}` + v.subtotals.map((t) => ` · ${t.label} ${fmtScore(t.total)}/${t.max}`).join('');
}
