/**
 * Candidate recordings: files under RECORDINGS_DIR/<orgId>/<sessionId>/<segmentId>.{webm,mp4}.
 * The most sensitive data we hold: paths never leave the server, files are served only on the
 * protected session route, and the retention job deletes them after the hiring decision.
 * Logs carry ids and counts only.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import type { RecordingSegment as SegmentRow } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { cfg } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';

const execFileP = promisify(execFile);
const DAY_MS = 86_400_000;

export function extensionFor(mimeType: string): 'webm' | 'mp4' {
  return mimeType.toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm';
}

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Serialises work per segment: chunk appends, remux and deletion never interleave. */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key);
    }
  }

  pathFor(orgId: string, sessionId: string, segmentId: string, mimeType: string): string {
    return join(cfg().recordingsDir, orgId, sessionId, `${segmentId}.${extensionFor(mimeType)}`);
  }

  /** Creates the (empty) file so the path exists from the first moment. */
  async createFile(path: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    const h = await fs.open(path, 'a');
    await h.close();
  }

  /** O_APPEND write of one chunk. */
  async append(path: string, chunk: Buffer): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.appendFile(path, chunk, { flag: 'a' });
  }

  /** The playable file of a live (non-deleted) segment, org-scoped. 404 when deleted or missing. */
  async fileFor(orgId: string, sessionId: string, segmentId: string): Promise<{ path: string; mimeType: string }> {
    const seg = await this.prisma.recordingSegment.findFirst({
      where: { id: segmentId, sessionId, orgId, deletedAt: null },
      select: { path: true, mimeType: true },
    });
    if (!seg) throw new NotFoundException('recording not found');
    try {
      const st = await fs.stat(seg.path);
      if (!st.isFile()) throw new Error('not a file');
    } catch {
      throw new NotFoundException('recording not found');
    }
    return { path: seg.path, mimeType: seg.mimeType };
  }

  /** Fire-and-forget remux after stop; tracked so tests (and shutdown) can drain it. */
  scheduleRemux(segmentId: string): void {
    const p = this.remux(segmentId).catch((e: Error) => {
      this.logger.warn(`remux of segment ${segmentId} failed: ${firstLine(e.message)}`);
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  /**
   * Rewrites the file with ffmpeg (stream copy) so the container carries cues/duration and seeks.
   * Atomic: writes <path>.tmp then renames. On failure the original is kept and remuxedAt stays
   * null (the daily job retries).
   */
  async remux(segmentId: string): Promise<boolean> {
    return this.withLock(segmentId, async () => {
      const seg = await this.prisma.recordingSegment.findUnique({ where: { id: segmentId } });
      if (!seg || seg.deletedAt || seg.remuxedAt || seg.chunks === 0) return false;
      const mp4 = seg.path.endsWith('.mp4');
      const tmp = `${seg.path}.tmp`;
      const args = ['-y', '-nostdin', '-loglevel', 'error', '-i', seg.path, '-c', 'copy'];
      if (mp4) args.push('-movflags', '+faststart');
      args.push('-f', mp4 ? 'mp4' : 'webm', tmp);
      try {
        await execFileP('ffmpeg', args, { timeout: 15 * 60_000, maxBuffer: 1 << 20 });
        const out = await fs.stat(tmp);
        if (out.size === 0) throw new Error('empty output');
        await fs.rename(tmp, seg.path);
        await this.prisma.recordingSegment.update({
          where: { id: segmentId },
          data: { remuxedAt: new Date(), bytes: BigInt(out.size) },
        });
        this.logger.log(`remuxed segment ${segmentId}`);
        return true;
      } catch (e) {
        await fs.rm(tmp, { force: true });
        this.logger.warn(`remux of segment ${segmentId} failed; original kept (${firstLine((e as Error).message)})`);
        return false;
      }
    });
  }

  /** Segments never stopped (page closed) whose upload went quiet over an hour ago, plus retries. */
  async remuxStale(now = new Date()): Promise<number> {
    const quietBefore = new Date(now.getTime() - 3_600_000);
    const rows = await this.prisma.recordingSegment.findMany({
      where: {
        deletedAt: null,
        remuxedAt: null,
        chunks: { gt: 0 },
        OR: [{ endedAt: { not: null } }, { lastChunkAt: { lt: quietBefore } }],
      },
      select: { id: true },
    });
    let ok = 0;
    for (const r of rows) if (await this.remux(r.id)) ok += 1;
    if (rows.length) this.logger.log(`remux sweep: ${ok}/${rows.length} segment(s) remuxed`);
    return ok;
  }

  /**
   * Deletes files RECORDING_RETENTION_DAYS after the candidate's decision; undecided candidates
   * fall back to 365 days after the session ended. Marks segments deleted; logs counts only.
   */
  async runRetention(now = new Date()): Promise<{ deleted: number; failed: number }> {
    const cutoff = new Date(now.getTime() - cfg().recordingRetentionDays * DAY_MS);
    const yearAgo = new Date(now.getTime() - 365 * DAY_MS);
    const rows = await this.prisma.recordingSegment.findMany({
      where: {
        deletedAt: null,
        OR: [
          { session: { application: { candidate: { decisionAt: { lt: cutoff } } } } },
          { session: { endedAt: { lt: yearAgo }, application: { candidate: { decisionAt: null } } } },
        ],
      },
      select: { id: true, path: true },
    });
    let deleted = 0;
    let failed = 0;
    for (const r of rows) {
      try {
        await this.withLock(r.id, async () => {
          await fs.rm(r.path, { force: true });
          await fs.rm(`${r.path}.tmp`, { force: true });
          await this.prisma.recordingSegment.update({ where: { id: r.id }, data: { deletedAt: now } });
        });
        await fs.rmdir(dirname(r.path)).catch(() => undefined); // only when empty
        deleted += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`retention: could not delete segment ${r.id}: ${firstLine((e as Error).message)}`);
      }
    }
    if (rows.length) this.logger.log(`retention: ${deleted} segment(s) deleted, ${failed} failed`);
    return { deleted, failed };
  }

  @Cron('15 3 * * *', { name: 'recordings-daily', timeZone: 'Europe/London' })
  async daily(): Promise<void> {
    try {
      await this.runRetention();
      await this.remuxStale();
    } catch (e) {
      this.logger.error(`daily recordings job failed: ${firstLine((e as Error).message)}`);
    }
  }

  @Timeout('recordings-after-boot', 60_000)
  async afterBoot(): Promise<void> {
    await this.daily();
  }
}

function firstLine(s: string | undefined): string {
  return (s ?? '').split('\n')[0].slice(0, 200);
}

export type { SegmentRow };
