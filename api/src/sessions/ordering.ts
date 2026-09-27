/**
 * v1.2: per-session display order for shuffled sections. Crypto-random Fisher–Yates; the session
 * stores questionOrder (keys in display order) and choiceOrders (per key: display index →
 * canonical choice index). Everything the candidate sees is in display order; the server maps back.
 */
import { randomInt } from 'node:crypto';

export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface OrderableQuestion {
  key: string;
  mode: string;
  choices: unknown;
}

export function makeSessionOrders(questions: OrderableQuestion[]): { questionOrder: string[]; choiceOrders: Record<string, number[]> } {
  const questionOrder = shuffled(questions.map((q) => q.key));
  const choiceOrders: Record<string, number[]> = {};
  for (const q of questions) {
    if (q.mode === 'mcq' && Array.isArray(q.choices) && q.choices.length > 1) {
      choiceOrders[q.key] = shuffled(q.choices.map((_, i) => i));
    }
  }
  return { questionOrder, choiceOrders };
}

/** Questions (canonical order) rearranged into the session's display order; unknown keys are dropped, missing keys appended. */
export function inDisplayOrder<T extends { key: string }>(canonical: T[], questionOrder: unknown): T[] {
  if (!Array.isArray(questionOrder)) return canonical;
  const byKey = new Map(canonical.map((q) => [q.key, q]));
  const out: T[] = [];
  for (const k of questionOrder) {
    const q = typeof k === 'string' ? byKey.get(k) : undefined;
    if (q) {
      out.push(q);
      byKey.delete(q.key);
    }
  }
  for (const q of canonical) if (byKey.has(q.key)) out.push(q);
  return out;
}

/** Display index → canonical index for one question, or null when unshuffled/invalid. */
export function choiceOrderFor(choiceOrders: unknown, key: string, n: number): number[] | null {
  if (!choiceOrders || typeof choiceOrders !== 'object') return null;
  const o = (choiceOrders as Record<string, unknown>)[key];
  if (!Array.isArray(o) || o.length !== n || o.some((i) => !Number.isInteger(i) || (i as number) < 0 || (i as number) >= n)) return null;
  if (new Set(o).size !== n) return null;
  return o as number[];
}

export function toCanonicalChoice(order: number[] | null, display: number): number {
  return order ? order[display] : display;
}

export function toDisplayChoice(order: number[] | null, canonical: number): number {
  return order ? order.indexOf(canonical) : canonical;
}
