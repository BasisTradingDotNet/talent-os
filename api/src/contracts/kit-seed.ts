/**
 * Kit seed file format — TYPES ONLY. FROZEN for v0 (orchestrator changes only).
 *
 * kit/parse-kit.ts turns a kit written in Markdown into a KitSeed JSON file; the API's seeder
 * loads that file into the database. Real kits contain model answers, so their seed files live
 * in private/ (gitignored), never in git. kit/fixtures/sample.seed.json is a synthetic example.
 */
import type { DimensionDef, Question, SectionDef } from './api';

export type SectionSeed = Omit<SectionDef, 'questionKeys'>;

/** Question order within a section is ascending `number`; sections run in array order. */
export type QuestionSeed = Omit<Question, 'id'>;

export interface KitSeed {
  slug: string;
  title: string;
  version: string;
  /** Organisation that owns the kit, e.g. "G-20 Group". */
  orgName: string;
  job: { title: string; location: string | null };
  candidateInstructions: string;
  dimensions: DimensionDef[];
  sections: SectionSeed[];
  questions: QuestionSeed[];
}
