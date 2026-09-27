import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Kit as KitRow, Organization, Question as QuestionRow } from '@prisma/client';
import type { Band, DimensionDef, Kit, Question, SectionDef } from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import { cfg } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';

export type KitWithQuestions = KitRow & { questions: QuestionRow[]; job: { title: string } };

/** In-memory view of a kit row: sections in kit order, questions ordered by section then number. */
export interface LoadedKit {
  row: KitRow;
  jobTitle: string;
  sections: SectionSeed[];
  questions: QuestionRow[];
}

export function sectionsOf(row: { sections: unknown }): SectionSeed[] {
  return (row.sections as unknown as SectionSeed[]) ?? [];
}

export function dimensionsOf(row: { dimensions: unknown }): DimensionDef[] {
  return (row.dimensions as unknown as DimensionDef[]) ?? [];
}

export function orderQuestions(sections: SectionSeed[], questions: QuestionRow[]): QuestionRow[] {
  const order = new Map(sections.map((s, i) => [s.key, i]));
  return [...questions].sort(
    (a, b) => (order.get(a.section) ?? 999) - (order.get(b.section) ?? 999) || a.number - b.number,
  );
}

export function toQuestion(q: QuestionRow): Question {
  return {
    id: q.id,
    key: q.key,
    section: q.section,
    stage: q.stage,
    number: q.number,
    title: q.title,
    domain: q.domain as Question['domain'],
    difficulty: (q.difficulty as Question['difficulty']) ?? null,
    mode: q.mode as Question['mode'],
    timeMinutes: q.timeMinutes ?? null,
    prompt: q.prompt,
    dataset: (q.dataset as Question['dataset']) ?? null,
    code: (q.code as Question['code']) ?? null,
    modelAnswer: q.modelAnswer ?? null,
    rubric: (q.rubric as Question['rubric']) ?? null,
    trapOrBonus: q.trapOrBonus ?? null,
    whatGoodLooksLike: q.whatGoodLooksLike ?? null,
    choices: (q.choices as string[] | null) ?? null,
    correctChoice: q.correctChoice ?? null,
    market: (q.market as Question['market']) ?? null,
  };
}

export function toSectionDef(s: SectionSeed, questions: QuestionRow[]): SectionDef {
  return {
    key: s.key,
    stage: s.stage,
    label: s.label,
    candidateLabel: s.candidateLabel,
    scoring: s.scoring,
    timeMinutes: s.timeMinutes ?? null,
    maxScore: s.maxScore ?? null,
    bands: (s.bands ?? []).map((b) => ({ min: b.min, label: b.label })),
    dimensionIds: s.dimensionIds ?? [],
    recommendationOptions: s.recommendationOptions ?? [],
    domainGroups: (s.domainGroups ?? []).map((g) => ({ domain: g.domain, label: g.label })),
    candidateView: !!s.candidateView,
    showInstructions: !!s.showInstructions,
    interviewerNotes: s.interviewerNotes ?? null,
    selfPaced: !!s.selfPaced,
    shuffle: !!s.shuffle,
    autoScoring: s.autoScoring
      ? { correct: s.autoScoring.correct, wrong: s.autoScoring.wrong, blank: s.autoScoring.blank }
      : null,
    candidateInstructions: s.candidateInstructions ?? null,
    questionKeys: questions
      .filter((q) => q.section === s.key)
      .sort((a, b) => a.number - b.number)
      .map((q) => q.key),
  };
}

export function toKit(k: LoadedKit): Kit {
  return {
    id: k.row.id,
    slug: k.row.slug,
    title: k.row.title,
    version: k.row.version,
    jobTitle: k.jobTitle,
    candidateInstructions: k.row.candidateInstructions,
    dimensions: dimensionsOf(k.row).map((d) => ({ id: d.id, name: d.name })),
    sections: k.sections.map((s) => toSectionDef(s, k.questions)),
    questions: k.questions.map(toQuestion),
  };
}

@Injectable()
export class KitService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's organisation (DEFAULT_ORG_SLUG). 503 until seeded. */
  async org(): Promise<Organization> {
    const org = await this.prisma.organization.findUnique({ where: { slug: cfg().defaultOrgSlug } });
    if (!org) throw new ServiceUnavailableException('organisation not seeded yet');
    return org;
  }

  /** ACTIVE_KIT_SLUG's newest version if set, else the org's most recently created kit. */
  async activeKit(orgId: string): Promise<LoadedKit> {
    const slug = cfg().activeKitSlug;
    const row = await this.prisma.kit.findFirst({
      where: { orgId, ...(slug ? { slug } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { questions: true, job: { select: { title: true } } },
    });
    if (!row) throw new NotFoundException('no active kit');
    return this.load(row);
  }

  async kitById(orgId: string, kitId: string): Promise<LoadedKit> {
    const row = await this.prisma.kit.findFirst({
      where: { id: kitId, orgId },
      include: { questions: true, job: { select: { title: true } } },
    });
    if (!row) throw new NotFoundException('kit not found');
    return this.load(row);
  }

  private load(row: KitWithQuestions): LoadedKit {
    const sections = sectionsOf(row);
    return { row, jobTitle: row.job.title, sections, questions: orderQuestions(sections, row.questions) };
  }

  async updateBands(orgId: string, sectionKey: string, bands: Band[]): Promise<Kit> {
    const kit = await this.activeKit(orgId);
    const idx = kit.sections.findIndex((s) => s.key === sectionKey);
    if (idx < 0) throw new NotFoundException('section not found');
    const sections = kit.sections.map((s, i) => (i === idx ? { ...s, bands } : s));
    await this.prisma.kit.update({
      where: { id: kit.row.id },
      data: { sections: sections as unknown as object },
    });
    return toKit(await this.activeKit(orgId));
  }
}
