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
import { MarketService } from '../market/market.service';
import { RecordingsService } from '../recordings/recordings.service';
import { choiceOrderFor, inDisplayOrder, toCanonicalChoice, toDisplayChoice } from '../sessions/ordering';
import { applyEnd, applyPresent } from '../sessions/sessions.service';
import { sectionEndsAt } from '../sessions/timing';
import { autoScoreFor } from '../sessions/verdict';
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
  questionOrder: true,
  choiceOrders: true,
  org: { select: { name: true } },
  kit: { select: { candidateInstructions: true, sections: true } },
} satisfies Prisma.SessionSelect;

export type TokenSessionRow = Prisma.SessionGetPayload<{ select: typeof TOKEN_SESSION_SELECT }>;

/** A candidate-token session together with its (candidateView) section definition. */
export interface TokenSession {
  session: TokenSessionRow;
  section: SectionSeed;
}

/** A display-ordered question with its server-side choice mapping (display index → canonical). */
interface DisplayQuestion extends CandidateStateQuestion {
  choiceOrder: number[] | null;
}

export interface EventInput {
  type: IntegrityEventType;
  clientAt: Date | null;
  detail: string | null;
}

@Injectable()
export class CandidateViewService {
  private readonly logger = new Logger(CandidateViewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recordings: RecordingsService,
    private readonly market: MarketService,
  ) {}

  /**
   * 404 for unknown tokens, for cancelled sessions (v1.3: the link is dead) and for sections
   * without a candidate view. Never reveals which. Every candidate endpoint goes through here.
   */
  async load(token: string): Promise<TokenSession> {
    if (!TOKEN.test(token)) throw new NotFoundException();
    const session = await this.prisma.session.findUnique({ where: { candidateToken: token }, select: TOKEN_SESSION_SELECT });
    if (!session || session.status === 'cancelled') throw new NotFoundException();
    const section = ((session.kit.sections as unknown as SectionSeed[]) ?? []).find((s) => s.key === session.section);
    if (!section || !section.candidateView) throw new NotFoundException();
    return { session, section };
  }

  /**
   * Only the allowlisted question columns, in THIS candidate's display order (v1.2: shuffled
   * sections). `choiceOrder` (display → canonical) stays server-side for mapping answers back.
   */
  private async questions(ts: TokenSession): Promise<DisplayQuestion[]> {
    const rows = await this.prisma.question.findMany({
      where: { kitId: ts.session.kitId, section: ts.session.section },
      select: { key: true, prompt: true, dataset: true, code: true, timeMinutes: true, mode: true, choices: true },
      orderBy: { number: 'asc' },
    });
    const canonical = rows.map((q) => {
      const choices = q.mode === 'mcq' && Array.isArray(q.choices) ? (q.choices as unknown[]).map((c) => String(c)) : null;
      const choiceOrder = choices ? choiceOrderFor(ts.session.choiceOrders, q.key, choices.length) : null;
      return {
        key: q.key,
        prompt: q.prompt,
        dataset: (q.dataset as { format: 'csv'; text: string } | null) ?? null,
        code: (q.code as { language: string; text: string } | null) ?? null,
        timeMinutes: q.timeMinutes ?? null,
        choices: choices && choiceOrder ? choiceOrder.map((ci) => choices[ci]) : choices,
        choiceOrder,
      };
    });
    return inDisplayOrder(canonical, ts.session.questionOrder);
  }

  private stateSection(ts: TokenSession) {
    const sec = ts.section;
    return {
      candidateLabel: sec.candidateLabel,
      showInstructions: !!sec.showInstructions,
      selfPaced: !!sec.selfPaced,
      autoScoring: sec.scoring === 'auto' && sec.autoScoring ? sec.autoScoring : null,
      candidateInstructions: sec.candidateInstructions ?? null,
    };
  }

  endsAt(ts: TokenSession): Date | null {
    return sectionEndsAt(ts.session.startedAt, ts.section.timeMinutes, ts.session.extensionMinutes);
  }

  async state(ts: TokenSession, now = new Date()): Promise<CandidateState> {
    const s = ts.session;
    const questions = await this.questions(ts);
    const responses = await this.prisma.response.findMany({
      where: { sessionId: s.id },
      select: { questionKey: true, candidateAnswer: true, candidateAnswerAt: true, choice: true },
    });
    const byKey = new Map(responses.map((r) => [r.questionKey, r]));
    const answeredPositions: number[] = [];
    questions.forEach((q, i) => {
      const r = byKey.get(q.key);
      if (r && ((r.choice !== null && r.choice !== undefined) || (r.candidateAnswer ?? '').trim() !== '')) answeredPositions.push(i + 1);
    });
    const presentedQ = s.presentedQuestionKey ? questions.find((q) => q.key === s.presentedQuestionKey) : undefined;
    const presented = presentedQ ? byKey.get(presentedQ.key) : undefined;
    const sectionQuestions: CandidateStateQuestion[] = questions.map((q) => ({
      key: q.key,
      prompt: q.prompt,
      dataset: q.dataset,
      code: q.code,
      timeMinutes: q.timeMinutes,
      choices: q.choices,
    }));
    const market = await this.market.candidateMarket(s.id);
    return buildCandidateState({
      market,
      orgName: cfg().candidateBrand ?? s.org.name,
      section: this.stateSection(ts),
      candidateInstructions: s.kit.candidateInstructions,
      status: s.status,
      presentedQuestionKey: s.presentedQuestionKey,
      presentedAt: s.presentedAt,
      version: s.version,
      sectionQuestions,
      now,
      recordingRequired: s.recordingRequired,
      consentAt: s.consentAt,
      retentionDays: cfg().recordingRetentionDays,
      presentedAnswer: presented && presentedQ
        ? {
            candidateAnswer: presented.candidateAnswer,
            candidateAnswerAt: presented.candidateAnswerAt,
            displayChoice:
              presented.choice !== null && presented.choice !== undefined ? toDisplayChoice(presentedQ.choiceOrder, presented.choice) : null,
          }
        : null,
      sectionEndsAt: this.endsAt(ts),
      answeredPositions,
    });
  }

  private assertNotTimeUp(ts: TokenSession, now: Date): void {
    const endsAt = this.endsAt(ts);
    if (endsAt && now.getTime() > endsAt.getTime() + ANSWER_GRACE_AFTER_TIME_UP_MS) {
      throw new ConflictException({ statusCode: 409, message: 'section time is up', reason: 'time_up' });
    }
  }

  /**
   * v1.2: stores a multiple-choice answer (display index → canonical) with its auto score. Self-paced:
   * any position; live: presented now or earlier. 409 time_up / not_live.
   */
  async saveChoice(ts: TokenSession, position: number, displayChoice: number | null): Promise<{ savedAt: string }> {
    const s = ts.session;
    const now = new Date();
    if (s.status !== 'live') throw new ConflictException({ statusCode: 409, message: 'session is not live', reason: 'not_live' });
    this.assertNotTimeUp(ts, now);
    const questions = await this.questions(ts);
    const q = questions[position - 1];
    if (!q) throw new BadRequestException('position out of range');
    if (!q.choices) throw new BadRequestException('question is not multiple choice');
    if (displayChoice !== null && (displayChoice < 0 || displayChoice >= q.choices.length)) throw new BadRequestException('choice out of range');
    const canonical = displayChoice === null ? null : toCanonicalChoice(q.choiceOrder, displayChoice);
    // correctChoice is read here only to score; it never reaches the candidate payload.
    const row = await this.prisma.question.findFirst({
      where: { kitId: s.kitId, section: s.section, key: q.key },
      select: { correctChoice: true },
    });
    const marking = ts.section.scoring === 'auto' && ts.section.autoScoring ? ts.section.autoScoring : null;
    const autoScore = marking ? autoScoreFor(marking, canonical, row?.correctChoice ?? null) : null;
    const data = { choice: canonical, autoScore, candidateAnswerAt: now };
    if (ts.section.selfPaced) {
      await this.prisma.response.upsert({
        where: { sessionId_questionKey: { sessionId: s.id, questionKey: q.key } },
        create: { sessionId: s.id, questionKey: q.key, ...data },
        update: data,
      });
    } else {
      const updated = await this.prisma.response.updateMany({
        where: { sessionId: s.id, questionKey: q.key, firstPresentedAt: { not: null } },
        data,
      });
      if (updated.count === 0) throw new ConflictException({ statusCode: 409, message: 'question has not been presented', reason: 'not_presented' });
    }
    return { savedAt: now.toISOString() };
  }

  private assertSelfPaced(ts: TokenSession): void {
    if (!ts.section.selfPaced) throw new ConflictException({ statusCode: 409, message: 'section is interviewer-driven', reason: 'not_self_paced' });
  }

  /** v1.2: the candidate starts a self-paced section (ready → live). Gated on consent and devices when recording is required. */
  async start(ts: TokenSession): Promise<void> {
    this.assertSelfPaced(ts);
    const s = ts.session;
    if (s.status === 'live') return;
    if (s.status !== 'ready') throw new ConflictException({ statusCode: 409, message: 'session is not ready', reason: 'not_live' });
    if (s.recordingRequired) {
      if (!s.consentAt) throw new ConflictException({ statusCode: 409, message: 'consent required', reason: 'consent_required' });
      const segs = await this.prisma.recordingSegment.findMany({ where: { sessionId: s.id, deletedAt: null }, select: { stream: true } });
      const streams = new Set(segs.map((x) => x.stream));
      if (!streams.has('camera') || !streams.has('screen')) {
        throw new ConflictException({ statusCode: 409, message: 'camera and screen recording required', reason: 'devices_required' });
      }
    }
    const now = new Date();
    await this.prisma.session.updateMany({
      where: { id: s.id, status: 'ready' },
      data: { status: 'live', startedAt: now, version: { increment: 1 } },
    });
    this.logger.log(`self-paced session ${s.id} started by candidate`);
  }

  /** v1.2: the candidate moves to a displayed position (same accounting as the interviewer's /present). */
  async navigate(ts: TokenSession, position: number): Promise<void> {
    this.assertSelfPaced(ts);
    const s = ts.session;
    if (s.status !== 'live') throw new ConflictException({ statusCode: 409, message: 'session is not live', reason: 'not_live' });
    const questions = await this.questions(ts);
    const q = questions[position - 1];
    if (!q) throw new BadRequestException('position out of range');
    const now = new Date();
    await this.prisma.$transaction((tx) => applyPresent(tx, s, q.key, now));
  }

  /** v1.2: the candidate submits a self-paced section (→ completed). Idempotent once completed. */
  async submit(ts: TokenSession): Promise<void> {
    this.assertSelfPaced(ts);
    const s = ts.session;
    if (s.status === 'completed') return;
    if (s.status !== 'live') throw new ConflictException({ statusCode: 409, message: 'session is not live', reason: 'not_live' });
    const now = new Date();
    await this.prisma.$transaction((tx) => applyEnd(tx, s, now));
    this.logger.log(`self-paced session ${s.id} submitted by candidate`);
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
    this.assertNotTimeUp(ts, now);
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
