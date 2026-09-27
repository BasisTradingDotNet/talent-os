import { Body, Controller, Get, Param, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Session, UpdateRating, UpdateResponse, UpdateSession } from '../contracts/api';
import { asObject, bad, optBool, optNullableInt, optNullableString, optString, reqString } from '../common/validate';
import { CallerEmail } from '../identity/identity.guard';
import { KitService } from '../kit/kit.service';
import { RecordingsService } from '../recordings/recordings.service';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly kits: KitService,
    private readonly recordings: RecordingsService,
  ) {}

  @Post()
  async create(@CallerEmail() email: string, @Body() body: unknown): Promise<Session> {
    const o = asObject(body);
    const candidateId = reqString(o, 'candidateId', { max: 200 });
    const section = reqString(o, 'section', { max: 50 });
    const recordingRequired = optBool(o, 'recordingRequired');
    const org = await this.kits.org();
    return this.sessions.create(org.id, email, candidateId, section, recordingRequired);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<Session> {
    const org = await this.kits.org();
    return this.sessions.get(org.id, id);
  }

  @Post(':id/start')
  async start(@Param('id') id: string): Promise<Session> {
    const org = await this.kits.org();
    return this.sessions.start(org.id, id);
  }

  @Post(':id/present')
  async present(@Param('id') id: string, @Body() body: unknown): Promise<Session> {
    const o = asObject(body);
    const key = o.questionKey;
    if (key !== null && (typeof key !== 'string' || !key)) bad('questionKey must be a non-empty string or null');
    const org = await this.kits.org();
    return this.sessions.present(org.id, id, key as string | null);
  }

  @Put(':id/responses/:questionKey')
  async response(
    @Param('id') id: string,
    @Param('questionKey') questionKey: string,
    @Body() body: unknown,
  ): Promise<Session> {
    const o = asObject(body);
    const patch: UpdateResponse = {
      score: optNullableInt(o, 'score', 0, 3) as UpdateResponse['score'],
      notes: optString(o, 'notes'),
      trapNoticed: optBool(o, 'trapNoticed'),
      bonusGiven: optBool(o, 'bonusGiven'),
      skipped: optBool(o, 'skipped'),
      markedForReturn: optBool(o, 'markedForReturn'),
    };
    const org = await this.kits.org();
    return this.sessions.updateResponse(org.id, id, questionKey, patch);
  }

  @Put(':id/ratings/:dimensionId')
  async rating(
    @Param('id') id: string,
    @Param('dimensionId') dimensionIdRaw: string,
    @Body() body: unknown,
  ): Promise<Session> {
    const dimensionId = Number(dimensionIdRaw);
    if (!Number.isInteger(dimensionId)) bad('dimensionId must be an integer');
    const o = asObject(body);
    const patch: UpdateRating = { rating: optNullableInt(o, 'rating', 1, 5), note: optString(o, 'note') };
    const org = await this.kits.org();
    return this.sessions.updateRating(org.id, id, dimensionId, patch);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<Session> {
    const o = asObject(body);
    const patch: UpdateSession = {
      setNotes: optString(o, 'setNotes', 100000),
      recommendation: optNullableString(o, 'recommendation', 200),
    };
    const interviewer = optString(o, 'interviewer', 320);
    if (interviewer !== undefined) {
      if (!interviewer.trim()) bad('interviewer must not be empty');
      patch.interviewer = interviewer.trim();
    }
    const org = await this.kits.org();
    return this.sessions.patch(org.id, id, patch);
  }

  @Post(':id/end')
  async end(@Param('id') id: string): Promise<Session> {
    const org = await this.kits.org();
    return this.sessions.end(org.id, id);
  }

  @Post(':id/reopen')
  async reopen(@Param('id') id: string): Promise<Session> {
    const org = await this.kits.org();
    return this.sessions.reopen(org.id, id);
  }

  /** v1.1 */
  @Post(':id/extend')
  async extend(@Param('id') id: string, @Body() body: unknown): Promise<Session> {
    const o = asObject(body);
    const minutes = o.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      bad('minutes must be an integer between 1 and 60');
    }
    const org = await this.kits.org();
    return this.sessions.extend(org.id, id, minutes);
  }

  /**
   * PROTECTED playback (behind IdentityGuard + Cloudflare Access). Streams the file with Range
   * support (206) so the player can seek. Org-scoped; 404 once deleted.
   */
  @Get(':id/recordings/:segmentId')
  async recording(
    @Param('id') id: string,
    @Param('segmentId') segmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const org = await this.kits.org();
    await this.sessions.get(org.id, id); // 404 unless the session belongs to the caller's org
    const file = await this.recordings.fileFor(org.id, id, segmentId);
    await new Promise<void>((resolve, reject) => {
      res.sendFile(
        file.path,
        {
          acceptRanges: true,
          cacheControl: false,
          lastModified: false,
          etag: false,
          dotfiles: 'deny',
          headers: {
            'Content-Type': file.mimeType,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        },
        // Errors after the headers went out (client aborted a seek) are not reportable any more.
        (err) => (err && !res.headersSent ? reject(err) : resolve()),
      );
    });
  }
}
