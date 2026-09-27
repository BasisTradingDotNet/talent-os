import type { Band, Subtotal, Verdict } from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';

export interface VerdictQuestion {
  key: string;
  domain: string;
}

export interface VerdictResponse {
  questionKey: string;
  score: number | null;
  skipped: boolean;
}

/** Highest band whose min the total reaches; null below every band. */
export function bandFor(bands: Band[], total: number): Band | null {
  let best: Band | null = null;
  for (const b of [...bands].sort((a, c) => a.min - c.min)) {
    if (total >= b.min) best = b;
  }
  return best;
}

/**
 * Pure verdict for a rubric section. Only the section's own questions count; responses for
 * unknown keys are ignored. A question counts as skipped only when it has no score.
 */
export function computeVerdict(
  section: Pick<SectionSeed, 'maxScore' | 'bands' | 'domainGroups'>,
  sectionQuestions: VerdictQuestion[],
  responses: VerdictResponse[],
): Verdict {
  const byKey = new Map(responses.map((r) => [r.questionKey, r]));
  let total = 0;
  let scored = 0;
  let skipped = 0;
  const domainTotals = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  for (const q of sectionQuestions) {
    domainCounts.set(q.domain, (domainCounts.get(q.domain) ?? 0) + 1);
    const r = byKey.get(q.key);
    if (r && r.score !== null && r.score !== undefined) {
      total += r.score;
      scored += 1;
      domainTotals.set(q.domain, (domainTotals.get(q.domain) ?? 0) + r.score);
    } else if (r && r.skipped) {
      skipped += 1;
    }
  }
  const n = sectionQuestions.length;
  const max = section.maxScore ?? 3 * n;
  const subtotals: Subtotal[] = (section.domainGroups ?? []).map((g) => ({
    domain: g.domain,
    label: g.label,
    total: domainTotals.get(g.domain) ?? 0,
    max: 3 * (domainCounts.get(g.domain) ?? 0),
  }));
  const band = bandFor(section.bands ?? [], total);
  return {
    total,
    max,
    scored,
    skipped,
    complete: n > 0 && scored + skipped === n,
    subtotals,
    band: band ? { min: band.min, label: band.label } : null,
    result: band?.label ?? 'Below threshold',
  };
}

/** Whole seconds a question has been presented for, never negative. */
export function elapsedSeconds(presentedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - presentedAt.getTime()) / 1000));
}
