import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { CandidateState, ChunkAck, SavedAnswer, StartedRecording } from '../contracts/api';
import { asObject, bad } from '../common/validate';
import { Public } from '../identity/identity.guard';
import { CandidateViewService, EventInput } from './candidate-view.service';
import { ANSWER_MAX_CHARS, EVENTS_PER_CALL_MAX, isEventType } from './consent';
import { CandidateRateLimitGuard } from './rate-limit';

function clientIp(req: Request): string | null {
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    const v = req.headers[name];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s.trim()) return s.trim().slice(0, 64);
  }
  return req.socket?.remoteAddress ?? null;
}

/**
 * PUBLIC, token-gated, rate-limited per token. Everything here is scoped to the token's own
 * session; the only data it ever returns is CandidateState and the small acks below. Recordings
 * are accepted here but never served here.
 */
@Public()
@UseGuards(CandidateRateLimitGuard)
@Controller('candidate')
export class CandidateViewController {
  constructor(private readonly view: CandidateViewService) {}

  @Get(':token/state')
  @Header('Cache-Control', 'no-store')
  async state(@Param('token') token: string): Promise<CandidateState> {
    return this.view.state(await this.view.load(token));
  }

  @Post(':token/consent')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async consent(@Param('token') token: string, @Body() body: unknown, @Req() req: Request): Promise<CandidateState> {
    const o = asObject(body);
    if (o.accepted !== true) bad('accepted must be true');
    const ts = await this.view.load(token);
    const ua = req.headers['user-agent'];
    await this.view.consent(ts, clientIp(req), typeof ua === 'string' ? ua : null);
    return this.view.state(await this.view.load(token));
  }

  @Put(':token/answer')
  @Header('Cache-Control', 'no-store')
  async answer(@Param('token') token: string, @Body() body: unknown): Promise<SavedAnswer> {
    const o = asObject(body);
    const position = o.position;
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 1) bad('position must be a positive integer');
    const text = o.text;
    if (typeof text !== 'string') bad('text must be a string');
    if (text.length > ANSWER_MAX_CHARS) bad(`text must be at most ${ANSWER_MAX_CHARS} characters`);
    return this.view.saveAnswer(await this.view.load(token), position, text);
  }

  /** v1.2: multiple choice. Display position + display option index; null clears. */
  @Put(':token/choice')
  @Header('Cache-Control', 'no-store')
  async choice(@Param('token') token: string, @Body() body: unknown): Promise<SavedAnswer> {
    const o = asObject(body);
    const position = o.position;
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 1) bad('position must be a positive integer');
    const choice = o.choice;
    if (choice !== null && (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0)) bad('choice must be a non-negative integer or null');
    return this.view.saveChoice(await this.view.load(token), position, choice as number | null);
  }

  /** v1.2: self-paced sections — the candidate starts. */
  @Post(':token/start')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async start(@Param('token') token: string): Promise<CandidateState> {
    await this.view.start(await this.view.load(token));
    // Open on the candidate's first question (their own shuffled order) unless they're already on one.
    const started = await this.view.load(token);
    if (!started.session.presentedQuestionKey) await this.view.navigate(started, 1);
    return this.view.state(await this.view.load(token));
  }

  /** v1.2: self-paced sections — the candidate moves to a displayed position. */
  @Post(':token/navigate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async navigate(@Param('token') token: string, @Body() body: unknown): Promise<CandidateState> {
    const o = asObject(body);
    const position = o.position;
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 1) bad('position must be a positive integer');
    await this.view.navigate(await this.view.load(token), position);
    return this.view.state(await this.view.load(token));
  }

  /** v1.2: self-paced sections — the candidate submits (→ completed). */
  @Post(':token/submit')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async submit(@Param('token') token: string): Promise<CandidateState> {
    await this.view.submit(await this.view.load(token));
    return this.view.state(await this.view.load(token));
  }

  @Post(':token/recordings')
  @HttpCode(201)
  async startRecording(@Param('token') token: string, @Body() body: unknown): Promise<StartedRecording> {
    const o = asObject(body);
    const stream = o.stream;
    if (stream !== 'camera' && stream !== 'screen') bad('stream must be camera or screen');
    const mimeType = o.mimeType;
    if (typeof mimeType !== 'string' || mimeType.length > 200 || !/^video\/(webm|mp4)(;|$)/i.test(mimeType)) {
      bad('mimeType must start with video/webm or video/mp4');
    }
    return this.view.startRecording(await this.view.load(token), stream, mimeType);
  }

  /** Raw body (see app-setup.ts): one chunk, at most 8 MB. */
  @Put(':token/recordings/:segmentId/chunks/:seq')
  async chunk(
    @Param('token') token: string,
    @Param('segmentId') segmentId: string,
    @Param('seq') seqRaw: string,
    @Body() body: unknown,
  ): Promise<ChunkAck> {
    if (!/^\d{1,9}$/.test(seqRaw)) bad('seq must be a non-negative integer');
    if (!Buffer.isBuffer(body)) bad('body must be raw bytes');
    if (body.length === 0) bad('chunk is empty');
    return this.view.appendChunk(await this.view.load(token), segmentId, Number(seqRaw), body);
  }

  @Post(':token/recordings/:segmentId/stop')
  @HttpCode(204)
  async stopRecording(@Param('token') token: string, @Param('segmentId') segmentId: string): Promise<void> {
    await this.view.stopRecording(await this.view.load(token), segmentId);
  }

  @Post(':token/events')
  @HttpCode(204)
  async events(@Param('token') token: string, @Body() body: unknown): Promise<void> {
    const o = asObject(body);
    if (!Array.isArray(o.events)) bad('events must be an array');
    if (o.events.length > EVENTS_PER_CALL_MAX) bad(`at most ${EVENTS_PER_CALL_MAX} events per call`);
    const events: EventInput[] = o.events.map((raw: unknown) => {
      const e = asObject(raw, 'event');
      if (!isEventType(e.type)) bad('event.type is not a known integrity event');
      if (typeof e.clientAt !== 'string') bad('event.clientAt must be a string');
      const clientAt = new Date(e.clientAt);
      if (e.detail !== undefined && typeof e.detail !== 'string') bad('event.detail must be a string');
      return {
        type: e.type,
        clientAt: Number.isNaN(clientAt.getTime()) ? null : clientAt,
        detail: typeof e.detail === 'string' && e.detail ? e.detail : null,
      };
    });
    await this.view.addEvents(await this.view.load(token), events);
  }
}
