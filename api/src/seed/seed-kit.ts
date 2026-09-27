/**
 * Kit seeder. Loads a KitSeed (see contracts/kit-seed.ts) into the database.
 *
 * - Creates the organisation (slug = orgSlug, name = seed.orgName) and job when absent.
 * - Kit (org, slug, version) already present → no-op, unless `force`, which refreshes question
 *   content and section fields but PRESERVES the existing bands (thresholds are edited in-app).
 */
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import type { KitSeed, QuestionSeed, SectionSeed } from '../contracts/kit-seed';

export class KitSeedError extends Error {}

function fail(msg: string): never {
  throw new KitSeedError(msg);
}

const SCORING = new Set(['rubric', 'dimensions']);

/** Validates the shape and the cross-references of a seed; throws KitSeedError with a reason. */
export function validateKitSeed(input: unknown): KitSeed {
  if (!input || typeof input !== 'object') fail('seed must be a JSON object');
  const s = input as Record<string, unknown>;
  for (const k of ['slug', 'title', 'version', 'orgName', 'candidateInstructions']) {
    if (typeof s[k] !== 'string' || !(s[k] as string).trim()) fail(`seed.${k} must be a non-empty string`);
  }
  const job = s.job as Record<string, unknown> | undefined;
  if (!job || typeof job !== 'object' || typeof job.title !== 'string' || !job.title.trim()) {
    fail('seed.job.title must be a non-empty string');
  }
  if (job.location !== null && job.location !== undefined && typeof job.location !== 'string') {
    fail('seed.job.location must be a string or null');
  }
  if (!Array.isArray(s.dimensions)) fail('seed.dimensions must be an array');
  const dimIds = new Set<number>();
  for (const d of s.dimensions as unknown[]) {
    const dd = d as Record<string, unknown>;
    if (!dd || typeof dd.id !== 'number' || typeof dd.name !== 'string') fail('dimension must be {id:number,name:string}');
    if (dimIds.has(dd.id)) fail(`duplicate dimension id ${dd.id}`);
    dimIds.add(dd.id);
  }
  if (!Array.isArray(s.sections) || s.sections.length === 0) fail('seed.sections must be a non-empty array');
  const sectionKeys = new Set<string>();
  for (const raw of s.sections as unknown[]) {
    const sec = raw as Record<string, unknown>;
    if (!sec || typeof sec.key !== 'string' || !sec.key) fail('section.key must be a non-empty string');
    if (sectionKeys.has(sec.key)) fail(`duplicate section key ${sec.key}`);
    sectionKeys.add(sec.key);
    if (typeof sec.stage !== 'number') fail(`section ${sec.key}: stage must be a number`);
    if (typeof sec.label !== 'string' || typeof sec.candidateLabel !== 'string') fail(`section ${sec.key}: label/candidateLabel required`);
    if (!SCORING.has(sec.scoring as string)) fail(`section ${sec.key}: scoring must be rubric|dimensions`);
    if (!Array.isArray(sec.bands)) fail(`section ${sec.key}: bands must be an array`);
    for (const b of sec.bands as unknown[]) {
      const bb = b as Record<string, unknown>;
      if (!bb || typeof bb.min !== 'number' || typeof bb.label !== 'string') fail(`section ${sec.key}: band must be {min,label}`);
    }
    if (!Array.isArray(sec.dimensionIds)) fail(`section ${sec.key}: dimensionIds must be an array`);
    for (const id of sec.dimensionIds as unknown[]) {
      if (typeof id !== 'number' || !dimIds.has(id)) fail(`section ${sec.key}: unknown dimension id ${String(id)}`);
    }
    if (!Array.isArray(sec.recommendationOptions)) fail(`section ${sec.key}: recommendationOptions must be an array`);
    if (!Array.isArray(sec.domainGroups)) fail(`section ${sec.key}: domainGroups must be an array`);
  }
  if (!Array.isArray(s.questions)) fail('seed.questions must be an array');
  const qKeys = new Set<string>();
  const numbersBySection = new Map<string, number[]>();
  for (const raw of s.questions as unknown[]) {
    const q = raw as Record<string, unknown>;
    if (!q || typeof q.key !== 'string' || !q.key) fail('question.key must be a non-empty string');
    if (qKeys.has(q.key)) fail(`duplicate question key ${q.key}`);
    qKeys.add(q.key);
    if (typeof q.section !== 'string' || !sectionKeys.has(q.section)) fail(`question ${q.key}: unknown section ${String(q.section)}`);
    if (typeof q.number !== 'number' || !Number.isInteger(q.number)) fail(`question ${q.key}: number must be an integer`);
    if (typeof q.stage !== 'number') fail(`question ${q.key}: stage must be a number`);
    for (const k of ['title', 'domain', 'mode', 'prompt']) {
      if (typeof q[k] !== 'string') fail(`question ${q.key}: ${k} must be a string`);
    }
    const arr = numbersBySection.get(q.section) ?? [];
    arr.push(q.number);
    numbersBySection.set(q.section, arr);
  }
  for (const [key, nums] of numbersBySection) {
    const sorted = [...nums].sort((a, b) => a - b);
    sorted.forEach((n, i) => {
      if (n !== i + 1) fail(`section ${key}: question numbers must be contiguous from 1 (got ${sorted.join(',')})`);
    });
  }
  return input as KitSeed;
}

export interface SeedOptions {
  orgSlug: string;
  force?: boolean;
}

export interface SeedResult {
  kitId: string;
  action: 'created' | 'updated' | 'unchanged';
}

function questionData(q: QuestionSeed) {
  return {
    section: q.section,
    stage: q.stage,
    number: q.number,
    title: q.title,
    domain: q.domain,
    difficulty: q.difficulty ?? null,
    mode: q.mode,
    timeMinutes: q.timeMinutes ?? null,
    prompt: q.prompt,
    dataset: (q.dataset ?? undefined) as object | undefined,
    code: (q.code ?? undefined) as object | undefined,
    modelAnswer: q.modelAnswer ?? null,
    rubric: (q.rubric ?? undefined) as object | undefined,
    trapOrBonus: q.trapOrBonus ?? null,
    whatGoodLooksLike: q.whatGoodLooksLike ?? null,
  };
}

export async function seedKit(prisma: PrismaClient, seed: KitSeed, opts: SeedOptions): Promise<SeedResult> {
  validateKitSeed(seed);
  return prisma.$transaction(async (tx) => {
    const org =
      (await tx.organization.findUnique({ where: { slug: opts.orgSlug } })) ??
      (await tx.organization.create({ data: { slug: opts.orgSlug, name: seed.orgName } }));
    const job =
      (await tx.job.findFirst({ where: { orgId: org.id, title: seed.job.title } })) ??
      (await tx.job.create({ data: { orgId: org.id, title: seed.job.title, location: seed.job.location ?? null } }));

    const existing = await tx.kit.findUnique({
      where: { orgId_slug_version: { orgId: org.id, slug: seed.slug, version: seed.version } },
      include: { questions: { select: { key: true } } },
    });

    if (!existing) {
      const kit = await tx.kit.create({
        data: {
          orgId: org.id,
          jobId: job.id,
          slug: seed.slug,
          version: seed.version,
          title: seed.title,
          candidateInstructions: seed.candidateInstructions,
          dimensions: seed.dimensions as unknown as object,
          sections: seed.sections as unknown as object,
          questions: { create: seed.questions.map((q) => ({ key: q.key, ...questionData(q) })) },
        },
      });
      return { kitId: kit.id, action: 'created' };
    }
    if (!opts.force) return { kitId: existing.id, action: 'unchanged' };

    const oldSections = (existing.sections as unknown as SectionSeed[]) ?? [];
    const sections = seed.sections.map((s) => {
      const prev = oldSections.find((o) => o.key === s.key);
      return prev ? { ...s, bands: prev.bands } : s;
    });
    await tx.kit.update({
      where: { id: existing.id },
      data: {
        jobId: job.id,
        title: seed.title,
        candidateInstructions: seed.candidateInstructions,
        dimensions: seed.dimensions as unknown as object,
        sections: sections as unknown as object,
      },
    });
    const keep = new Set(seed.questions.map((q) => q.key));
    await tx.question.deleteMany({ where: { kitId: existing.id, key: { notIn: [...keep] } } });
    for (const q of seed.questions) {
      await tx.question.upsert({
        where: { kitId_key: { kitId: existing.id, key: q.key } },
        create: { kitId: existing.id, key: q.key, ...questionData(q) },
        update: questionData(q),
      });
    }
    return { kitId: existing.id, action: 'updated' };
  });
}

export function readKitSeed(path: string): KitSeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`cannot read seed file: ${(e as Error).message}`);
  }
  return validateKitSeed(parsed);
}

export async function seedKitFile(prisma: PrismaClient, path: string, opts: SeedOptions): Promise<SeedResult> {
  return seedKit(prisma, readKitSeed(path), opts);
}
