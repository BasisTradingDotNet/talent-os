import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CandidateState, IntegrityEventType, RecordingStream } from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import { cfg } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingsService } from '../recordings/recordings.service';
import { sectionEndsAt } from '../sessions/timing';
import { buildCandidateState, CandidateStateQuestion } from './candidate-state';
import {
  ANSWER_GRACE_AFTER_END_MS,
  ANSWER_GRACE_AFTER_TIME_UP_MS,
  BYTES_PER_SESSION_MAX,
  CHUNK_GRACE_AFTER_END_MS,
  CONSENT_VERSION,
  EVENT_DETAIL_MAX,
  EVENTS_PER_SESSION_MAX,
  SEGMENTS_PER_SESSION_MAX,
} from './consent';

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

const TOKEN_SESSION_SELECT = {
  id: true,
  orgId: true,
  kitId: true,
  section: true,
  status: true,
  presentedQuestionKey: true,
  presentedAt: true,
  version: true,
  startedAt: true,
  endedAt: true,
  recordingRequired: true,
  consentAt: true,
  extensionMinutes: true,
  org: { select: { name: true } },
  kit: { select: { candidateInstructions: true, sections: true } },
} satisfies Prisma.SessionSelect;

export type TokenSessionRow = Prisma.SessionGetPayload<{ select: typeof TOKEN_SESSION_SELECT }>;

/** A candidate-token session together with its (candidateView) section definition. */
export interface TokenSession {
  session: TokenSessionRow;
  section: SectionSeed;
}

export interface EventInput {
  type: IntegrityEventType;
  clientAt: Date | null;
  detail: string | null;
}

@Injectable()
export class CandidateViewService {
  private readonly logger = new Logger(CandidateViewService.name);

  constructor(private readonly prisma: PrismaService, private readonly recordings: RecordingsService) {}

  /** 404 for unknown tokens and for sections without a candidate view. Never reveals which. */
  async load(token: string): Promise<TokenSession> {
    if (!TOKEN.test(token)) throw new NotFoundException();
    const session = await this.prisma.session.findUnique({ where: { candidateToken: token }, select: TOKEN_SESSION_SELECT });
    if (!session) throw new NotFoundException();
    const section = ((session.kit.sections as unknown as SectionSeed[]) ?? []).find((s) => s.key === session.section);
    if (!section || !section.candidateView) throw new NotFoundException();
    return { session, section };
  }

  /** Only the allowlisted question columns, in running order. */
  private async questions(ts: TokenSession): Promise<CandidateStateQuestion[]> {
    const rows = await this.prisma.question.findMany({
      where: { kitId: ts.session.kitId, section: ts.session.section },
      select: { key: true, prompt: true, dataset: true, code: true, timeMinutes: true },
      orderBy: { number: 'asc' },
    });
    return rows.map((q) => ({
      key: q.key,
      prompt: q.prompt,
      dataset: (q.dataset as { format: 'csv'; text: string } | null) ?? null,
      code: (q.code as { language: string; text: string } | null) ?? null,
      timeMinutes: q.timeMinutes ?? null,
    }));
  }

  endsAt(ts: TokenSession): Date | null {
    return sectionEndsAt(ts.session.startedAt, ts.section.timeMinutes, ts.session.extensionMinutes);
  }

  async state(ts: TokenSession, now = new Date()): Promise<CandidateState> {
    const s = ts.session;
    const presented = s.presentedQuestionKey
      ? await this.prisma.response.findUnique({
          where: { sessionId_questionKey: { sessionId: s.id, questionKey: s.presentedQuestionKey } },
          select: { candidateAnswer: true, candidateAnswerAt: true },
        })
      : null;
    return buildCandidateState({
      orgName: cfg().candidateBrand ?? s.org.name,
      section: { candidateLabel: ts.section.candidateLabel, showInstructions: !!ts.section.showInstructions },
      candidateInstructions: s.kit.candidateInstructions,
      status: s.status,
      presentedQuestionKey: s.presentedQuestionKey,
      presentedAt: s.presentedAt,
      version: s.version,
      sectionQuestions: await this.questions(ts),
      now,
      recordingRequired: s.recordingRequired,
      consentAt: s.consentAt,
      retentionDays: cfg().recordingRetentionDays,
      presentedAnswer: presented
        ? { candidateAnswer: presented.candidateAnswer, candidateAnswerAt: presented.candidateAnswerAt }
        : null,
      sectionEndsAt: this.endsAt(ts),
    });
  }

  /** First consent wins; later calls are no-ops. Appends a consent_given event. */
  async consent(ts: TokenSession, ip: string | null, userAgent: string | null): Promise<void> {
    const s = ts.session;
    if (s.consentAt) return;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.session.updateMany({
        where: { id: s.id, consentAt: null },
        data: {
          consentAt: now,
          consentIp: ip,
          consentUserAgent: userAgent ? userAgent.slice(0, 500) : null,
          consentVersion: CONSENT_VERSION,
          version: { increment: 1 },
        },
      });
      if (r.count === 0) return;
      await tx.sessionEvent.create({
        data: { sessionId: s.id, type: 'consent_given', at: now, clientAt: null, questionKey: s.presentedQuestionKey, detail: null },
      });
    });
    this.logger.log(`consent recorded for session ${s.id}`);
  }

  /**
   * Stores the candidate's typed answer. 409 unless the question was presented (now or earlier),
   * the session is live or ended within the last minute, and the section time has not run out.
   */
  async saveAnswer(ts: TokenSession, position: number, text: string): Promise<{ savedAt: string }> {
    const s = ts.session;
    const now = new Date();
    const endedWithinGrace = s.status === 'completed' && !!s.endedAt && now.getTime() - s.endedAt.getTime() <= ANSWER_GRACE_AFTER_END_MS;
    if (s.status !== 'live' && !endedWithinGrace) throw new ConflictException({ statusCode: 409, message: 'session is not live', reason: 'not_live' });
    const endsAt = this.endsAt(ts);
    if (endsAt && now.getTime() > endsAt.getTime() + ANSWER_GRACE_AFTER_TIME_UP_MS) {
      throw new ConflictException({ statusCode: 409, message: 'section time is up', reason: 'time_up' });
    }
    const questions = await this.questions(ts);
    const q = questions[position - 1];
    if (!q) throw new BadRequestException('position out of range');
    const updated = await this.prisma.response.updateMany({
      where: { sessionId: s.id, questionKey: q.key, firstPresentedAt: { not: null } },
      data: { candidateAnswer: text, candidateAnswerAt: now },
    });
    if (updated.count === 0) throw new ConflictException({ statusCode: 409, message: 'question has not been presented', reason: 'not_presented' });
    return { savedAt: now.toISOString() };
  }

  async startRecording(ts: TokenSession, stream: RecordingStream, mimeType: string): Promise<{ segmentId: string }> {
    const s = ts.session;
    if (!s.consentAt) throw new ConflictException({ statusCode: 409, message: 'consent required', reason: 'consent_required' });
    if (s.status !== 'ready' && s.status !== 'live') throw new ConflictException({ statusCode: 409, message: 'session is not running', reason: 'not_live' });
    const count = await this.prisma.recordingSegment.count({ where: { sessionId: s.id } });
    if (count >= SEGMENTS_PER_SESSION_MAX) throw new ConflictException({ statusCode: 409, message: 'too many segments', reason: 'too_many_segments' });
    const created = await this.prisma.recordingSegment.create({
      data: { orgId: s.orgId, sessionId: s.id, stream, mimeType, path: '' },
      select: { id: true },
    });
    const path = this.recordings.pathFor(s.orgId, s.id, created.id, mimeType);
    await this.recordings.createFile(path);
    await this.prisma.recordingSegment.update({ where: { id: created.id }, data: { path } });
    this.logger.log(`segment ${created.id} (${stream}) started for session ${s.id}`);
    return { segmentId: created.id };
  }

  /** Contiguous seq: dup → no-op 200, gap → 409 {expected}. Appends under the per-segment lock. */
  async appendChunk(ts: TokenSession, segmentId: string, seq: number, chunk: Buffer): Promise<{ received: number }> {
    if (!ID.test(segmentId)) throw new NotFoundException();
    const s = ts.session;
    const now = new Date();
    const endedWithinGrace = s.status === 'completed' && !!s.endedAt && now.getTime() - s.endedAt.getTime() <= CHUNK_GRACE_AFTER_END_MS;
    if (s.status !== 'ready' && s.status !== 'live' && !endedWithinGrace) {
      throw new ConflictException({ statusCode: 409, message: 'session is not running', reason: 'not_live' });
    }
    return this.recordings.withLock(segmentId, async () => {
      const seg = await this.prisma.recordingSegment.findFirst({ where: { id: segmentId, sessionId: s.id, deletedAt: null } });
      if (!seg) throw new NotFoundException();
      const next = seg.chunks;
      if (seq < next) return { received: next };
      if (seq > next) throw new ConflictException({ statusCode: 409, message: 'chunk out of order', expected: next });
      if (seg.remuxedAt) throw new ConflictException({ statusCode: 409, message: 'segment is closed', expected: next });
      const total = await this.prisma.recordingSegment.aggregate({ where: { sessionId: s.id }, _sum: { bytes: true } });
      const used = total._sum.bytes ?? 0n;
      if (used + BigInt(chunk.length) > BYTES_PER_SESSION_MAX) throw new PayloadTooLargeException('session recording limit reached');
      await this.recordings.append(seg.path, chunk);
      const updated = await this.prisma.recordingSegment.update({
        where: { id: seg.id },
        data: { chunks: { increment: 1 }, bytes: { increment: BigInt(chunk.length) }, lastChunkAt: now },
        select: { chunks: true },
      });
      return { received: updated.chunks };
    });
  }

  async stopRecording(ts: TokenSession, segmentId: string): Promise<void> {
    if (!ID.test(segmentId)) throw new NotFoundException();
    const seg = await this.prisma.recordingSegment.findFirst({ where: { id: segmentId, sessionId: ts.session.id, deletedAt: null } });
    if (!seg) throw new NotFoundException();
    if (!seg.endedAt) await this.prisma.recordingSegment.update({ where: { id: seg.id }, data: { endedAt: new Date() } });
    this.recordings.scheduleRemux(seg.id);
  }

  /** questionKey and `at` are server-derived; detail is truncated; capped per session. */
  async addEvents(ts: TokenSession, events: EventInput[]): Promise<void> {
    if (events.length === 0) return;
    const s = ts.session;
    const existing = await this.prisma.sessionEvent.count({ where: { sessionId: s.id } });
    const room = Math.max(0, EVENTS_PER_SESSION_MAX - existing);
    if (room === 0) return;
    const now = new Date();
    await this.prisma.sessionEvent.createMany({
      data: events.slice(0, room).map((e, i) => ({
        sessionId: s.id,
        type: e.type,
        at: new Date(now.getTime() + i), // preserve order within a batch
        clientAt: e.clientAt,
        questionKey: s.presentedQuestionKey,
        detail: e.detail ? e.detail.slice(0, EVENT_DETAIL_MAX) : null,
      })),
    });
  }
}
