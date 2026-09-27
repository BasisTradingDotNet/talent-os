import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma, Question as QuestionRow } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type {
  DimensionRating,
  IntegrityEvent,
  RecordingSegment,
  ResponseRecord,
  Session,
  SessionSummary,
  UpdateRating,
  UpdateResponse,
  UpdateSession,
  Verdict,
} from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import { INTEGRITY_FLAG_TYPES } from '../candidate-view/consent';
import { cfg } from '../common/config';
import { bad } from '../common/validate';
import { KitService, LoadedKit } from '../kit/kit.service';
import { PrismaService } from '../prisma/prisma.service';
import { sectionEndsAt } from './timing';
import { makeSessionOrders } from './ordering';
import { computeAutoVerdict, computeVerdict, elapsedSeconds } from './verdict';

/** v1.2: self-paced sessions are completed automatically this long after sectionEndsAt. */
export const SELF_PACED_AUTO_COMPLETE_MS = 60_000;

/** Enough for a SessionSummary (lists): counts only for recordings and integrity flags. */
export const SESSION_SUMMARY_INCLUDE = {
  responses: true,
  ratings: true,
  application: { include: { candidate: { select: { id: true, name: true } } } },
  _count: {
    select: {
      segments: { where: { deletedAt: null } },
      events: { where: { type: { in: [...INTEGRITY_FLAG_TYPES] } } } },
  },
} satisfies Prisma.SessionInclude;

/** Cap on the integrity timeline returned with a Session (oldest first). */
export const EVENTS_CAP = 500;

/** A full Session: live segments (paths stay server-side) and the integrity timeline. */
export const SESSION_INCLUDE = {
  ...SESSION_SUMMARY_INCLUDE,
  segments: { where: { deletedAt: null }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] },
  events: { orderBy: [{ at: 'asc' }, { id: 'asc' }], take: EVENTS_CAP },
} satisfies Prisma.SessionInclude;

export type SessionSummaryRow = Prisma.SessionGetPayload<{ include: typeof SESSION_SUMMARY_INCLUDE }>;
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
    candidateAnswer: r.candidateAnswer ?? null,
    candidateAnswerAt: iso(r.candidateAnswerAt),
    firstPresentedAt: iso(r.firstPresentedAt),
    choice: r.choice ?? null,
    autoScore: r.autoScore ?? null,
    aiDraftNote: null, // transcription not built yet
    aiDraftAt: null,
  };
}

export function toRating(r: SessionRow['ratings'][number]): DimensionRating {
  return { dimensionId: r.dimensionId, rating: r.rating ?? null, note: r.note };
}

/** Never includes the file path. */
export function toSegment(s: SessionRow['segments'][number]): RecordingSegment {
  return {
    id: s.id,
    stream: s.stream as RecordingSegment['stream'],
    mimeType: s.mimeType,
    startedAt: s.startedAt.toISOString(),
    endedAt: iso(s.endedAt),
    lastChunkAt: iso(s.lastChunkAt),
    bytes: Number(s.bytes),
    chunks: s.chunks,
  };
}

export function toEvent(e: SessionRow['events'][number]): IntegrityEvent {
  return {
    type: e.type as IntegrityEvent['type'],
    at: e.at.toISOString(),
    clientAt: iso(e.clientAt),
    questionKey: e.questionKey ?? null,
    detail: e.detail ?? null,
  };
}

export function verdictFor(row: SessionSummaryRow, ctx: SectionContext): Verdict | null {
  if (ctx.section.scoring === 'auto') {
    return computeAutoVerdict(
      ctx.section,
      ctx.questions.map((q) => ({ key: q.key, domain: q.domain })),
      row.responses.map((r) => ({ questionKey: r.questionKey, choice: r.choice ?? null, autoScore: r.autoScore ?? null })),
      row.status === 'completed',
    );
  }
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
    recording: {
      required: row.recordingRequired,
      consentAt: iso(row.consentAt),
      segments: row.segments.map(toSegment),
    },
    events: row.events.map(toEvent),
    sectionEndsAt: iso(sectionEndsAt(row.startedAt, ctx.section.timeMinutes, row.extensionMinutes)),
    extensionMinutes: row.extensionMinutes,
    questionOrder: Array.isArray(row.questionOrder) ? (row.questionOrder as string[]).map(String) : null,
    transcript: { status: 'none', model: null, noteModel: null, updatedAt: null, error: null, lines: [] }, // transcription not built yet
    market: null, // WIRE(market): SessionMarket for market sections
  };
}

/** v1.2: the shape both the interviewer's /present and the candidate's /navigate apply. */
export interface PresentTarget {
  id: string;
  status: string;
  presentedQuestionKey: string | null;
  presentedAt: Date | null;
  startedAt: Date | null;
}

/** Adds the elapsed time of the currently presented question to its response. */
export async function accountPresentedTime(tx: Prisma.TransactionClient, row: PresentTarget, now: Date): Promise<void> {
  if (!row.presentedQuestionKey || !row.presentedAt) return;
  const secs = elapsedSeconds(row.presentedAt, now);
  await tx.response.upsert({
    where: { sessionId_questionKey: { sessionId: row.id, questionKey: row.presentedQuestionKey } },
    create: { sessionId: row.id, questionKey: row.presentedQuestionKey, timeSpentSeconds: secs },
    update: { timeSpentSeconds: { increment: secs } },
  });
}

/** Presents a question (or null = intro): time accounting, firstPresentedAt, version bump; starts a ready session. */
export async function applyPresent(tx: Prisma.TransactionClient, row: PresentTarget, questionKey: string | null, now: Date): Promise<void> {
  await accountPresentedTime(tx, row, now);
  if (questionKey !== null) {
    // v1: remember the first presentation (never reset) so answers and playback can key off it.
    await tx.response.upsert({
      where: { sessionId_questionKey: { sessionId: row.id, questionKey } },
      create: { sessionId: row.id, questionKey, firstPresentedAt: now },
      update: {},
    });
    await tx.response.updateMany({
      where: { sessionId: row.id, questionKey, firstPresentedAt: null },
      data: { firstPresentedAt: now },
    });
  }
  await tx.session.update({
    where: { id: row.id },
    data: {
      presentedQuestionKey: questionKey,
      presentedAt: questionKey === null ? null : now,
      version: { increment: 1 },
      ...(row.status === 'ready' ? { status: 'live', startedAt: now } : {}),
    },
  });
}

/** Completes a session: time accounting, endedAt, intro screen, version bump. */
export async function applyEnd(tx: Prisma.TransactionClient, row: PresentTarget, now: Date): Promise<void> {
  await accountPresentedTime(tx, row, now);
  await tx.session.update({
    where: { id: row.id },
    data: {
      status: 'completed',
      presentedQuestionKey: null,
      presentedAt: null,
      endedAt: now,
      startedAt: row.startedAt ?? now,
      version: { increment: 1 },
    },
  });
}

export function toSummary(row: SessionSummaryRow, kit: LoadedKit, superseded: boolean): SessionSummary {
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
    recorded: row._count.segments > 0,
    integrityFlags: row._count.events,
  };
}

/** v1.2: crypto-random question and choice orders for a shuffled section. */
function shuffleData(questions: QuestionRow[]): Pick<Prisma.SessionUncheckedCreateInput, 'questionOrder' | 'choiceOrders'> {
  const { questionOrder, choiceOrders } = makeSessionOrders(questions.map((q) => ({ key: q.key, mode: q.mode, choices: q.choices })));
  return { questionOrder: questionOrder as unknown as Prisma.InputJsonValue, choiceOrders: choiceOrders as unknown as Prisma.InputJsonValue };
}

function selfPaced(): never {
  throw new ConflictException({ statusCode: 409, message: 'self-paced section: the candidate drives', reason: 'self_paced' });
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService, private readonly kits: KitService) {}

  /** v1.2: completes self-paced live sessions once sectionEndsAt + 60 s has passed. Runs every minute. */
  @Cron(CronExpression.EVERY_MINUTE)
  async completeExpiredSelfPaced(now = new Date()): Promise<number> {
    const live = await this.prisma.session.findMany({
      where: { status: 'live', startedAt: { not: null } },
      select: { id: true, orgId: true, kitId: true, section: true, status: true, presentedQuestionKey: true, presentedAt: true, startedAt: true, extensionMinutes: true, kit: { select: { sections: true } } },
    });
    let done = 0;
    for (const s of live) {
      const section = ((s.kit.sections as unknown as SectionSeed[]) ?? []).find((x) => x.key === s.section);
      if (!section?.selfPaced) continue;
      const endsAt = sectionEndsAt(s.startedAt, section.timeMinutes, s.extensionMinutes);
      if (!endsAt || now.getTime() < endsAt.getTime() + SELF_PACED_AUTO_COMPLETE_MS) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          const fresh = await tx.session.findFirst({ where: { id: s.id, status: 'live' }, select: { id: true } });
          if (!fresh) return;
          await applyEnd(tx, s, now);
          done += 1;
        });
        this.logger.log(`self-paced session ${s.id} auto-completed`);
      } catch (e) {
        this.logger.warn(`auto-complete failed for session ${s.id}: ${(e as Error).message}`);
      }
    }
    return done;
  }

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

  async create(
    orgId: string,
    interviewer: string,
    candidateId: string,
    sectionKey: string,
    recordingRequired?: boolean,
  ): Promise<Session> {
    const candidate = await this.prisma.candidate.findFirst({ where: { id: candidateId, orgId } });
    if (!candidate) throw new NotFoundException('candidate not found');
    const kit = await this.kits.activeKit(orgId);
    const section = kit.sections.find((s) => s.key === sectionKey);
    if (!section) bad(`unknown section ${sectionKey}`);
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
        recordingRequired: recordingRequired ?? !!section.candidateView,
        ...(section.shuffle ? shuffleData(sectionContext(kit, sectionKey).questions) : {}),
      },
      include: SESSION_INCLUDE,
    });
    return toSession(row, kit);
  }

  /** v1.1: adds minutes to the section time limit; bumps the candidate version so the countdown updates. */
  async extend(orgId: string, id: string, minutes: number): Promise<Session> {
    const row = await this.row(orgId, id);
    if (row.status !== 'ready' && row.status !== 'live') throw new ConflictException(`cannot extend a ${row.status} session`);
    await this.prisma.session.update({
      where: { id },
      data: { extensionMinutes: { increment: minutes }, version: { increment: 1 } },
    });
    return this.present_(orgId, id);
  }

  async start(orgId: string, id: string): Promise<Session> {
    const row = await this.row(orgId, id);
    const kit = await this.kits.kitById(orgId, row.kitId);
    if (sectionContext(kit, row.section).section.selfPaced) selfPaced();
    if (row.status === 'live') return this.present_(orgId, id);
    if (row.status !== 'ready') throw new ConflictException(`cannot start a ${row.status} session`);
    await this.prisma.session.update({
      where: { id },
      data: { status: 'live', startedAt: new Date(), version: { increment: 1 } },
    });
    return this.present_(orgId, id);
  }

  async present(orgId: string, id: string, questionKey: string | null): Promise<Session> {
    const row = await this.row(orgId, id);
    if (row.status === 'completed') throw new ConflictException('session is completed');
    const kit = await this.kits.kitById(orgId, row.kitId);
    const ctx = sectionContext(kit, row.section);
    if (ctx.section.selfPaced) selfPaced();
    if (questionKey !== null && !ctx.questions.some((q) => q.key === questionKey)) {
      bad(`question ${questionKey} is not in section ${row.section}`);
    }
    const now = new Date();
    await this.prisma.$transaction((tx) => applyPresent(tx, row, questionKey, now));
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
    await this.prisma.$transaction((tx) => applyEnd(tx, row, now));
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
