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

export interface AutoVerdictResponse {
  questionKey: string;
  /** Canonical index of the candidate's choice; null = blank. */
  choice: number | null;
  autoScore: number | null;
}

/**
 * v1.2: pure verdict for an `auto` (multiple-choice) section. total = Σ autoScore over the section's
 * questions with blanks counted as autoScoring.blank (fractional allowed); max = n × correct;
 * scored = answered; skipped = blank; complete = the session is completed or every question is
 * answered. Subtotals per domainGroup (max = count × correct).
 */
export function computeAutoVerdict(
  section: Pick<SectionSeed, 'maxScore' | 'bands' | 'domainGroups' | 'autoScoring'>,
  sectionQuestions: VerdictQuestion[],
  responses: AutoVerdictResponse[],
  sessionCompleted: boolean,
): Verdict {
  const marking = section.autoScoring ?? { correct: 1, wrong: 0, blank: 0 };
  const byKey = new Map(responses.map((r) => [r.questionKey, r]));
  let total = 0;
  let scored = 0;
  let skipped = 0;
  const domainTotals = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  for (const q of sectionQuestions) {
    domainCounts.set(q.domain, (domainCounts.get(q.domain) ?? 0) + 1);
    const r = byKey.get(q.key);
    let points: number;
    if (r && r.choice !== null && r.choice !== undefined) {
      points = r.autoScore ?? 0;
      scored += 1;
    } else {
      points = marking.blank;
      skipped += 1;
    }
    total += points;
    domainTotals.set(q.domain, (domainTotals.get(q.domain) ?? 0) + points);
  }
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  const n = sectionQuestions.length;
  const max = section.maxScore ?? round(n * marking.correct);
  const subtotals: Subtotal[] = (section.domainGroups ?? []).map((g) => ({
    domain: g.domain,
    label: g.label,
    total: round(domainTotals.get(g.domain) ?? 0),
    max: round((domainCounts.get(g.domain) ?? 0) * marking.correct),
  }));
  total = round(total);
  const band = bandFor(section.bands ?? [], total);
  return {
    total,
    max,
    scored,
    skipped,
    complete: n > 0 && (sessionCompleted || scored === n),
    subtotals,
    band: band ? { min: band.min, label: band.label } : null,
    result: band?.label ?? 'Below threshold',
  };
}

/** v1.2: points for one multiple-choice answer under the section's marking scheme. */
export function autoScoreFor(marking: { correct: number; wrong: number; blank: number }, choice: number | null, correctChoice: number | null): number {
  if (choice === null || choice === undefined) return marking.blank;
  return choice === correctChoice ? marking.correct : marking.wrong;
}
