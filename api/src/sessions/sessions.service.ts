import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Question as QuestionRow } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type {
  DimensionRating,
  ResponseRecord,
  Session,
  SessionSummary,
  UpdateRating,
  UpdateResponse,
  UpdateSession,
  Verdict,
} from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import { cfg } from '../common/config';
import { bad } from '../common/validate';
import { KitService, LoadedKit } from '../kit/kit.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeVerdict, elapsedSeconds } from './verdict';

export const SESSION_INCLUDE = {
  responses: true,
  ratings: true,
  application: { include: { candidate: { select: { id: true, name: true } } } },
} satisfies Prisma.SessionInclude;

export type SessionRow = Prisma.SessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

export interface SectionContext {
  section: SectionSeed;
  questions: QuestionRow[];
}

/** Per-request cache of pinned kits (sessions may span kit versions). */
export class KitCache {
  private readonly cache = new Map<string, Promise<LoadedKit>>();
  constructor(private readonly kits: KitService, private readonly orgId: string) {}
  get(kitId: string): Promise<LoadedKit> {
    let p = this.cache.get(kitId);
    if (!p) {
      p = this.kits.kitById(this.orgId, kitId);
      this.cache.set(kitId, p);
    }
    return p;
  }
}

export function sectionContext(kit: LoadedKit, sectionKey: string): SectionContext {
  const section = kit.sections.find((s) => s.key === sectionKey);
  if (!section) throw new NotFoundException('section not found in kit');
  const questions = kit.questions.filter((q) => q.section === sectionKey).sort((a, b) => a.number - b.number);
  return { section, questions };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toResponseRecord(r: SessionRow['responses'][number]): ResponseRecord {
  return {
    questionKey: r.questionKey,
    score: (r.score as ResponseRecord['score']) ?? null,
    notes: r.notes,
    trapNoticed: r.trapNoticed,
    bonusGiven: r.bonusGiven,
    skipped: r.skipped,
    markedForReturn: r.markedForReturn,
    timeSpentSeconds: r.timeSpentSeconds,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRating(r: SessionRow['ratings'][number]): DimensionRating {
  return { dimensionId: r.dimensionId, rating: r.rating ?? null, note: r.note };
}

export function verdictFor(row: SessionRow, ctx: SectionContext): Verdict | null {
  if (ctx.section.scoring !== 'rubric') return null;
  return computeVerdict(
    ctx.section,
    ctx.questions.map((q) => ({ key: q.key, domain: q.domain })),
    row.responses.map((r) => ({ questionKey: r.questionKey, score: r.score, skipped: r.skipped })),
  );
}

export function toSession(row: SessionRow, kit: LoadedKit, now = new Date()): Session {
  const ctx = sectionContext(kit, row.section);
  const order = new Map(ctx.questions.map((q, i) => [q.key, i]));
  const responses = [...row.responses]
    .sort((a, b) => (order.get(a.questionKey) ?? 999) - (order.get(b.questionKey) ?? 999))
    .map(toResponseRecord);
  return {
    id: row.id,
    candidateId: row.application.candidate.id,
    candidateName: row.application.candidate.name,
    section: row.section,
    kitId: row.kitId,
    kitVersion: kit.row.version,
    status: row.status as Session['status'],
    interviewer: row.interviewer,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    presentedQuestionKey: row.presentedQuestionKey ?? null,
    presentedAt: iso(row.presentedAt),
    candidateUrl: ctx.section.candidateView ? `${cfg().publicBaseUrl}/c/${row.candidateToken}` : null,
    setNotes: row.setNotes,
    recommendation: row.recommendation ?? null,
    responses,
    ratings: [...row.ratings].sort((a, b) => a.dimensionId - b.dimensionId).map(toRating),
    verdict: verdictFor(row, ctx),
    serverNow: now.toISOString(),
  };
}

export function toSummary(row: SessionRow, kit: LoadedKit, superseded: boolean): SessionSummary {
  const ctx = sectionContext(kit, row.section);
  return {
    id: row.id,
    section: row.section,
    status: row.status as SessionSummary['status'],
    interviewer: row.interviewer,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    verdict: verdictFor(row, ctx),
    ratings: [...row.ratings].sort((a, b) => a.dimensionId - b.dimensionId).map(toRating),
    recommendation: row.recommendation ?? null,
    trapsNoticed: row.responses.filter((r) => r.trapNoticed).length,
    bonusesGiven: row.responses.filter((r) => r.bonusGiven).length,
    superseded,
  };
}

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService, private readonly kits: KitService) {}

  private async row(orgId: string, id: string): Promise<SessionRow> {
    const row = await this.prisma.session.findFirst({ where: { id, orgId }, include: SESSION_INCLUDE });
    if (!row) throw new NotFoundException('session not found');
    return row;
  }

  private async present_(orgId: string, id: string): Promise<Session> {
    const row = await this.row(orgId, id);
    return toSession(row, await this.kits.kitById(orgId, row.kitId));
  }

  async get(orgId: string, id: string): Promise<Session> {
    return this.present_(orgId, id);
  }

  async create(orgId: string, interviewer: string, candidateId: string, sectionKey: string): Promise<Session> {
    const candidate = await this.prisma.candidate.findFirst({ where: { id: candidateId, orgId } });
    if (!candidate) throw new NotFoundException('candidate not found');
    const kit = await this.kits.activeKit(orgId);
    if (!kit.sections.some((s) => s.key === sectionKey)) bad(`unknown section ${sectionKey}`);
    const application =
      (await this.prisma.application.findUnique({
        where: { candidateId_jobId: { candidateId, jobId: kit.row.jobId } },
      })) ??
      (await this.prisma.application.create({ data: { orgId, candidateId, jobId: kit.row.jobId } }));
    const row = await this.prisma.session.create({
      data: {
        orgId,
        applicationId: application.id,
        kitId: kit.row.id,
        section: sectionKey,
        status: 'ready',
        interviewer,
        candidateToken: randomBytes(24).toString('base64url'),
      },
      include: SESSION_INCLUDE,
    });
    return toSession(row, kit);
  }

  async start(orgId: string, id: string): Promise<Session> {
    const row = await this.row(orgId, id);
    if (row.status === 'live') return this.present_(orgId, id);
    if (row.status !== 'ready') throw new ConflictException(`cannot start a ${row.status} session`);
    await this.prisma.session.update({
      where: { id },
      data: { status: 'live', startedAt: new Date(), version: { increment: 1 } },
    });
    return this.present_(orgId, id);
  }

  /** Adds the elapsed time of the currently presented question to its response. */
  private async accountTime(tx: Prisma.TransactionClient, row: SessionRow, now: Date): Promise<void> {
    if (!row.presentedQuestionKey || !row.presentedAt) return;
    const secs = elapsedSeconds(row.presentedAt, now);
    await tx.response.upsert({
      where: { sessionId_questionKey: { sessionId: row.id, questionKey: row.presentedQuestionKey } },
      create: { sessionId: row.id, questionKey: row.presentedQuestionKey, timeSpentSeconds: secs },
      update: { timeSpentSeconds: { increment: secs } },
    });
  }

  async present(orgId: string, id: string, questionKey: string | null): Promise<Session> {
    const row = await this.row(orgId, id);
    if (row.status === 'completed') throw new ConflictException('session is completed');
    const kit = await this.kits.kitById(orgId, row.kitId);
    const ctx = sectionContext(kit, row.section);
    if (questionKey !== null && !ctx.questions.some((q) => q.key === questionKey)) {
      bad(`question ${questionKey} is not in section ${row.section}`);
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.accountTime(tx, row, now);
      await tx.session.update({
        where: { id },
        data: {
          presentedQuestionKey: questionKey,
          presentedAt: questionKey === null ? null : now,
          version: { increment: 1 },
          ...(row.status === 'ready' ? { status: 'live', startedAt: now } : {}),
        },
      });
    });
    return this.present_(orgId, id);
  }

  async updateResponse(orgId: string, id: string, questionKey: string, patch: UpdateResponse): Promise<Session> {
    const row = await this.row(orgId, id);
    const kit = await this.kits.kitById(orgId, row.kitId);
    const ctx = sectionContext(kit, row.section);
    if (!ctx.questions.some((q) => q.key === questionKey)) throw new NotFoundException('question not in section');
    const data: Prisma.ResponseUncheckedUpdateInput = {};
    if (patch.score !== undefined) data.score = patch.score;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.trapNoticed !== undefined) data.trapNoticed = patch.trapNoticed;
    if (patch.bonusGiven !== undefined) data.bonusGiven = patch.bonusGiven;
    if (patch.skipped !== undefined) data.skipped = patch.skipped;
    if (patch.markedForReturn !== undefined) data.markedForReturn = patch.markedForReturn;
    await this.prisma.response.upsert({
      where: { sessionId_questionKey: { sessionId: id, questionKey } },
      create: { ...(data as Prisma.ResponseUncheckedCreateInput), sessionId: id, questionKey },
      update: data,
    });
    await this.prisma.session.update({ where: { id }, data: { version: { increment: 1 } } });
    return this.present_(orgId, id);
  }

  async updateRating(orgId: string, id: string, dimensionId: number, patch: UpdateRating): Promise<Session> {
    const row = await this.row(orgId, id);
    const kit = await this.kits.kitById(orgId, row.kitId);
    const ctx = sectionContext(kit, row.section);
    if (!ctx.section.dimensionIds.includes(dimensionId)) throw new NotFoundException('dimension not in section');
    const data: Prisma.RatingUncheckedUpdateInput = {};
    if (patch.rating !== undefined) data.rating = patch.rating;
    if (patch.note !== undefined) data.note = patch.note;
    await this.prisma.rating.upsert({
      where: { sessionId_dimensionId: { sessionId: id, dimensionId } },
      create: { ...(data as Prisma.RatingUncheckedCreateInput), sessionId: id, dimensionId },
      update: data,
    });
    return this.present_(orgId, id);
  }

  async patch(orgId: string, id: string, patch: UpdateSession): Promise<Session> {
    const row = await this.row(orgId, id);
    const kit = await this.kits.kitById(orgId, row.kitId);
    const ctx = sectionContext(kit, row.section);
    const data: Prisma.SessionUpdateInput = {};
    if (patch.setNotes !== undefined) data.setNotes = patch.setNotes;
    if (patch.interviewer !== undefined) data.interviewer = patch.interviewer;
    if (patch.recommendation !== undefined) {
      if (patch.recommendation !== null && !ctx.section.recommendationOptions.includes(patch.recommendation)) {
        bad('recommendation is not one of the section options');
      }
      data.recommendation = patch.recommendation;
    }
    await this.prisma.session.update({ where: { id }, data });
    return this.present_(orgId, id);
  }

  async end(orgId: string, id: string): Promise<Session> {
    const row = await this.row(orgId, id);
    if (row.status === 'completed') throw new ConflictException('session already completed');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.accountTime(tx, row, now);
      await tx.session.update({
        where: { id },
        data: {
          status: 'completed',
          presentedQuestionKey: null,
          presentedAt: null,
          endedAt: now,
          startedAt: row.startedAt ?? now,
          version: { increment: 1 },
        },
      });
    });
    return this.present_(orgId, id);
  }

  async reopen(orgId: string, id: string): Promise<Session> {
    const row = await this.row(orgId, id);
    if (row.status !== 'completed') throw new ConflictException('only completed sessions can be reopened');
    await this.prisma.session.update({
      where: { id },
      data: { status: 'live', endedAt: null, version: { increment: 1 } },
    });
    return this.present_(orgId, id);
  }
}
