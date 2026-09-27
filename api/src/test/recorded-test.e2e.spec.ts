import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-setup';
import type { CandidateDetail, CandidateState, Session } from '../contracts/api';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingsService } from '../recordings/recordings.service';
import { seedKitFile } from '../seed/seed-kit';

const API_DIR = resolve(__dirname, '../..');
const FIXTURE = resolve(API_DIR, '../kit/fixtures/sample.seed.json');
const AUTH = { 'cf-access-authenticated-user-email': 'tester@example.com' };
const DAY = 86_400_000;

describe('recorded written test (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let recordings: RecordingsService;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { cwd: API_DIR, env: process.env, stdio: 'ignore' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    recordings = app.get(RecordingsService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Organization","Job","Kit","Question","Candidate","Application","Session","Response","Rating","RecordingSegment","SessionEvent" CASCADE',
    );
    await seedKitFile(prisma, FIXTURE, { orgSlug: 'g20' });
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await recordings.drain();
    await app.close();
    rmSync(process.env.RECORDINGS_DIR!, { recursive: true, force: true });
  });

  async function newSession(name: string, extra: Record<string, unknown> = {}): Promise<{ candidate: CandidateDetail; session: Session; token: string; cand: string }> {
    const candidate = (await http.post('/api/candidates').set(AUTH).send({ name }).expect(201)).body as CandidateDetail;
    const session = (
      await http.post('/api/sessions').set(AUTH).send({ candidateId: candidate.id, section: 'A', ...extra }).expect(201)
    ).body as Session;
    const token = session.candidateUrl!.split('/c/')[1];
    return { candidate, session, token, cand: `/api/candidate/${token}` };
  }

  const putChunk = (cand: string, seg: string, seq: number, body: Buffer) =>
    http.put(`${cand}/recordings/${seg}/chunks/${seq}`).set('Content-Type', 'application/octet-stream').send(body);

  it('recordingRequired defaults to the section candidateView flag and can be overridden', async () => {
    const a = await newSession('Default Rec');
    expect(a.session.recording).toEqual({ required: true, consentAt: null, segments: [] });
    expect(a.session.events).toEqual([]);
    expect(a.session.sectionEndsAt).toBeNull();
    expect(a.session.extensionMinutes).toBe(0);
    const b = await newSession('No Rec', { recordingRequired: false });
    expect(b.session.recording.required).toBe(false);
    const state = (await http.get(`${b.cand}/state`).expect(200)).body as CandidateState;
    expect(state.recording).toEqual({ required: false, consentGiven: false, consentText: null });
    expect(state.answer).toBeNull();
    await http.post('/api/sessions').set(AUTH).send({ candidateId: a.candidate.id, section: 'A', recordingRequired: 'yes' }).expect(400);
  });

  it('consent gate: state carries the notice, recording start is 409 before consent, consent is recorded once', async () => {
    const { cand, session } = await newSession('Consent Case');
    let state = (await http.get(`${cand}/state`).expect(200)).body as CandidateState;
    expect(Object.keys(state).sort()).toEqual([
      'answer', 'answeredPositions', 'instructions', 'market', 'marking', 'orgName', 'phase', 'presentedAt', 'question', 'recording',
      'sectionEndsAt', 'sectionLabel', 'selfPaced', 'serverNow', 'version',
    ]);
    expect(Object.keys(state.recording).sort()).toEqual(['consentGiven', 'consentText', 'required']);
    expect(state.recording.required).toBe(true);
    expect(state.recording.consentGiven).toBe(false);
    expect(state.recording.consentText).toContain('Only the G-20 Group hiring team');
    expect(state.recording.consentText).toContain('deleted 90 days after');

    const refused = await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' }).expect(409);
    expect(refused.body.reason).toBe('consent_required');
    await http.post(`${cand}/consent`).send({ accepted: false }).expect(400);
    await http.post(`${cand}/consent`).send({}).expect(400);

    state = (
      await http.post(`${cand}/consent`).set('User-Agent', 'jest-agent/1.0').set('cf-connecting-ip', '203.0.113.9').send({ accepted: true }).expect(200)
    ).body as CandidateState;
    expect(state.recording.consentGiven).toBe(true);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.consentAt).toBeTruthy();
    expect(row.consentIp).toBe('203.0.113.9');
    expect(row.consentUserAgent).toBe('jest-agent/1.0');
    expect(row.consentVersion).toBe('rec-consent-v1');
    const first = row.consentAt!.getTime();
    await http.post(`${cand}/consent`).send({ accepted: true }).expect(200);
    const again = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(again.consentAt!.getTime()).toBe(first);
    const s = (await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session;
    expect(s.recording.consentAt).toBe(row.consentAt!.toISOString());
    expect(s.events.map((e) => e.type)).toEqual(['consent_given']);

    await http.post(`${cand}/recordings`).send({ stream: 'mic', mimeType: 'video/webm' }).expect(400);
    await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'audio/ogg' }).expect(400);
    const started = (await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm;codecs=vp8,opus' }).expect(201)).body;
    expect(Object.keys(started)).toEqual(['segmentId']);
  });

  it('chunks: contiguous seq, duplicates are no-ops, gaps 409 {expected}, bytes on disk = concatenation, limits', async () => {
    const { cand, session } = await newSession('Chunk Case');
    await http.post(`${cand}/consent`).send({ accepted: true }).expect(200);
    const seg = (await http.post(`${cand}/recordings`).send({ stream: 'screen', mimeType: 'video/webm' }).expect(201)).body.segmentId as string;
    const c0 = randomBytes(1500);
    const c1 = randomBytes(700);
    expect((await putChunk(cand, seg, 0, c0).expect(200)).body).toEqual({ received: 1 });
    expect((await putChunk(cand, seg, 0, c0).expect(200)).body).toEqual({ received: 1 }); // duplicate: no-op
    const gap = await putChunk(cand, seg, 2, c1).expect(409);
    expect(gap.body.expected).toBe(1);
    expect((await putChunk(cand, seg, 1, c1).expect(200)).body).toEqual({ received: 2 });
    await putChunk(cand, seg, 2, Buffer.alloc(0)).expect(400);
    await http.put(`${cand}/recordings/${seg}/chunks/x`).set('Content-Type', 'application/octet-stream').send(c1).expect(400);
    await putChunk(cand, 'nope00000000', 0, c1).expect(404);

    const row = await prisma.recordingSegment.findUniqueOrThrow({ where: { id: seg } });
    expect(row.chunks).toBe(2);
    expect(Number(row.bytes)).toBe(2200);
    expect(row.lastChunkAt).toBeTruthy();
    expect(row.path.startsWith(process.env.RECORDINGS_DIR!)).toBe(true);
    expect(row.path.endsWith(`/${row.orgId}/${session.id}/${seg}.webm`)).toBe(true);
    expect(Buffer.compare(readFileSync(row.path), Buffer.concat([c0, c1]))).toBe(0);

    // A JSON body on the chunk route is raw bytes too, never parsed.
    expect((await http.put(`${cand}/recordings/${seg}/chunks/2`).set('Content-Type', 'application/json').send('{"a":1}').expect(200)).body).toEqual({ received: 3 });
    expect(readFileSync(row.path).subarray(2200).toString()).toBe('{"a":1}');

    // Per-chunk limit (8 MB) → 413; per-session limit (6 GB) → 413.
    await putChunk(cand, seg, 3, Buffer.alloc(8 * 1024 * 1024 + 1)).expect(413);
    await prisma.recordingSegment.update({ where: { id: seg }, data: { bytes: 6n * 1024n * 1024n * 1024n - 10n } });
    await putChunk(cand, seg, 3, Buffer.alloc(11)).expect(413);
    expect((await putChunk(cand, seg, 3, Buffer.alloc(10)).expect(200)).body).toEqual({ received: 4 });

    const s = (await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session;
    expect(s.recording.segments).toHaveLength(1);
    expect(Object.keys(s.recording.segments[0]).sort()).toEqual(['bytes', 'chunks', 'endedAt', 'id', 'lastChunkAt', 'mimeType', 'startedAt', 'stream']);
    expect(s.recording.segments[0]).toMatchObject({ id: seg, stream: 'screen', chunks: 4, endedAt: null });
    expect(JSON.stringify(s)).not.toContain(process.env.RECORDINGS_DIR!);

    // Segment cap per session.
    await prisma.recordingSegment.createMany({
      data: Array.from({ length: 199 }, (_, i) => ({ orgId: row.orgId, sessionId: session.id, stream: 'camera', mimeType: 'video/webm', path: `/dev/null/${i}` })),
    });
    const capped = await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' }).expect(409);
    expect(capped.body.reason).toBe('too_many_segments');
    await prisma.recordingSegment.deleteMany({ where: { sessionId: session.id, path: { startsWith: '/dev/null/' } } });
  });

  it('stop sets endedAt and remuxes (original kept when ffmpeg rejects the bytes); chunks after end are limited to 10 min', async () => {
    const { cand, session } = await newSession('Stop Case');
    await http.post(`${cand}/consent`).send({ accepted: true }).expect(200);
    const seg = (await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/mp4' }).expect(201)).body.segmentId as string;
    const bytes = randomBytes(4096);
    await putChunk(cand, seg, 0, bytes).expect(200);
    await http.post(`${cand}/recordings/${seg}/stop`).expect(204);
    await recordings.drain();
    const row = await prisma.recordingSegment.findUniqueOrThrow({ where: { id: seg } });
    expect(row.endedAt).toBeTruthy();
    expect(row.path.endsWith('.mp4')).toBe(true);
    expect(row.remuxedAt).toBeNull(); // random bytes are not a video: ffmpeg fails, original kept
    expect(existsSync(`${row.path}.tmp`)).toBe(false);
    expect(Buffer.compare(readFileSync(row.path), bytes)).toBe(0);
    await http.post(`${cand}/recordings/${seg}/stop`).expect(204); // idempotent
    await http.post(`${cand}/recordings/nope00000000/stop`).expect(404);

    await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(201);
    await putChunk(cand, seg, 1, bytes).expect(200); // final flush within 10 min
    await prisma.session.update({ where: { id: session.id }, data: { endedAt: new Date(Date.now() - 11 * 60_000) } });
    const late = await putChunk(cand, seg, 2, bytes).expect(409);
    expect(late.body.reason).toBe('not_live');
    await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' }).expect(409);
  });

  it('answers: presented now or earlier → 200; not yet presented → 409; too long → 400; ended > 60 s → 409; time up → 409', async () => {
    const { cand, session } = await newSession('Answer Case');
    await http.put(`${cand}/answer`).send({ position: 1, text: 'early' }).expect(409); // ready
    await http.post(`/api/sessions/${session.id}/start`).set(AUTH).expect(201);
    let s = (await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A1' }).expect(201)).body as Session;
    expect(s.responses.find((r) => r.questionKey === 'A1')!.firstPresentedAt).toBeTruthy();
    expect(s.sectionEndsAt).toBe(new Date(new Date(s.startedAt!).getTime() + 12 * 60_000).toISOString());
    let state = (await http.get(`${cand}/state`).expect(200)).body as CandidateState;
    expect(state.answer).toEqual({ text: '', savedAt: null, choice: null });
    expect(state.sectionEndsAt).toBe(s.sectionEndsAt);

    const saved = (await http.put(`${cand}/answer`).send({ position: 1, text: 'mean is 0.042' }).expect(200)).body;
    expect(Object.keys(saved)).toEqual(['savedAt']);
    state = (await http.get(`${cand}/state`).expect(200)).body as CandidateState;
    expect(state.answer).toEqual({ text: 'mean is 0.042', savedAt: saved.savedAt });
    const notYet = await http.put(`${cand}/answer`).send({ position: 3, text: 'x' }).expect(409);
    expect(notYet.body.reason).toBe('not_presented');
    await http.put(`${cand}/answer`).send({ position: 9, text: 'x' }).expect(400);
    await http.put(`${cand}/answer`).send({ position: 1, text: 'x'.repeat(20_001) }).expect(400);
    await http.put(`${cand}/answer`).send({ position: 1, text: 'x'.repeat(20_000) }).expect(200);
    await http.put(`${cand}/answer`).send({ position: 0, text: 'x' }).expect(400);
    await http.put(`${cand}/answer`).send({ position: 1 }).expect(400);

    // Move on, then come back to A1: it was presented earlier, so saving is still allowed.
    await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A2' }).expect(201);
    await http.put(`${cand}/answer`).send({ position: 1, text: 'revised' }).expect(200);
    await http.put(`${cand}/answer`).send({ position: 2, text: 'second' }).expect(200);
    s = (await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session;
    const byKey = Object.fromEntries(s.responses.map((r) => [r.questionKey, r]));
    expect(byKey.A1).toMatchObject({ candidateAnswer: 'revised' });
    expect(byKey.A1.candidateAnswerAt).toBeTruthy();
    expect(byKey.A2).toMatchObject({ candidateAnswer: 'second' });
    expect(byKey.A3).toBeUndefined();

    // Final autosave: allowed up to 60 s after the end, not after.
    await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(201);
    await http.put(`${cand}/answer`).send({ position: 2, text: 'final' }).expect(200);
    await prisma.session.update({ where: { id: session.id }, data: { endedAt: new Date(Date.now() - 61_000) } });
    const late = await http.put(`${cand}/answer`).send({ position: 2, text: 'too late' }).expect(409);
    expect(late.body.reason).toBe('not_live');

    // v1.1: time up (15 s grace) on a backdated live session; an extension reopens the window.
    await http.post(`/api/sessions/${session.id}/reopen`).set(AUTH).expect(201);
    await prisma.session.update({ where: { id: session.id }, data: { startedAt: new Date(Date.now() - 12 * 60_000 - 20_000) } });
    await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A2' }).expect(201);
    const timeUp = await http.put(`${cand}/answer`).send({ position: 2, text: 'after the bell' }).expect(409);
    expect(timeUp.body.reason).toBe('time_up');
    const extended = (await http.post(`/api/sessions/${session.id}/extend`).set(AUTH).send({ minutes: 5 }).expect(201)).body as Session;
    expect(extended.extensionMinutes).toBe(5);
    expect(new Date(extended.sectionEndsAt!).getTime()).toBe(new Date(extended.startedAt!).getTime() + 17 * 60_000);
    await http.put(`${cand}/answer`).send({ position: 2, text: 'after the bell' }).expect(200);
    state = (await http.get(`${cand}/state`).expect(200)).body as CandidateState;
    expect(state.sectionEndsAt).toBe(extended.sectionEndsAt);
    await http.post(`/api/sessions/${session.id}/extend`).set(AUTH).send({ minutes: 0 }).expect(400);
    await http.post(`/api/sessions/${session.id}/extend`).set(AUTH).send({ minutes: 61 }).expect(400);
    await http.post(`/api/sessions/${session.id}/extend`).set(AUTH).send({ minutes: 1.5 }).expect(400);
    await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(201);
    await http.post(`/api/sessions/${session.id}/extend`).set(AUTH).send({ minutes: 5 }).expect(409);
  });

  it('events: questionKey is server-derived, detail truncated to 100 chars, unknown types rejected, capped', async () => {
    const { cand, session } = await newSession('Event Case');
    await http.post(`${cand}/events`).send({ events: [{ type: 'page_loaded', clientAt: '2026-09-27T14:00:00Z' }] }).expect(204);
    await http.post(`/api/sessions/${session.id}/start`).set(AUTH).expect(201);
    await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A2' }).expect(201);
    const long = 'x'.repeat(150);
    await http
      .post(`${cand}/events`)
      .send({
        events: [
          { type: 'paste', clientAt: '2026-09-27T14:00:01Z', detail: '412 chars', questionKey: 'A4' },
          { type: 'tab_hidden', clientAt: 'not a date', detail: long },
        ],
      })
      .expect(204);
    await http.post(`${cand}/events`).send({ events: [{ type: 'keylog', clientAt: '2026-09-27T14:00:01Z' }] }).expect(400);
    await http.post(`${cand}/events`).send({ events: [{ type: 'copy' }] }).expect(400);
    await http.post(`${cand}/events`).send({ events: Array.from({ length: 51 }, () => ({ type: 'copy', clientAt: '2026-09-27T14:00:01Z' })) }).expect(400);
    await http.post(`${cand}/events`).send({ events: 'nope' }).expect(400);

    const s = (await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session;
    expect(s.events.map((e) => [e.type, e.questionKey])).toEqual([
      ['page_loaded', null],
      ['paste', 'A2'],
      ['tab_hidden', 'A2'],
    ]);
    expect(Object.keys(s.events[1]).sort()).toEqual(['at', 'clientAt', 'detail', 'questionKey', 'type']);
    expect(s.events[1]).toMatchObject({ detail: '412 chars', clientAt: '2026-09-27T14:00:01.000Z' });
    expect(s.events[2].detail).toBe('x'.repeat(100));
    expect(s.events[2].clientAt).toBeNull();
    expect(new Date(s.events[2].at).getTime()).toBeGreaterThanOrEqual(new Date(s.events[1].at).getTime());

    const detail = (await http.get(`/api/candidates/${s.candidateId}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(detail.latest.A).toMatchObject({ recorded: false, integrityFlags: 2 });

    await prisma.sessionEvent.createMany({
      data: Array.from({ length: 4996 }, () => ({ sessionId: session.id, type: 'window_focus' })),
    });
    await http.post(`${cand}/events`).send({ events: [{ type: 'copy', clientAt: '2026-09-27T14:00:02Z' }, { type: 'copy', clientAt: '2026-09-27T14:00:03Z' }] }).expect(204);
    expect(await prisma.sessionEvent.count({ where: { sessionId: session.id } })).toBe(5000);
    const capped = (await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session;
    expect(capped.events).toHaveLength(500);
    expect(capped.events[0].type).toBe('page_loaded');
  });

  it('playback: protected route streams with Range (206) and the media is not reachable under /api/candidate/', async () => {
    const { cand, session } = await newSession('Playback Case');
    await http.post(`${cand}/consent`).send({ accepted: true }).expect(200);
    const seg = (await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm;codecs=vp8,opus' }).expect(201)).body.segmentId as string;
    const bytes = randomBytes(1000);
    await putChunk(cand, seg, 0, bytes).expect(200);

    const full = await http.get(`/api/sessions/${session.id}/recordings/${seg}`).set(AUTH).expect(200);
    expect(full.headers['content-type']).toBe('video/webm;codecs=vp8,opus');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['cache-control']).toBe('private, no-store');
    const partial = await http.get(`/api/sessions/${session.id}/recordings/${seg}`).set(AUTH).set('Range', 'bytes=100-199').expect(206);
    expect(partial.headers['content-range']).toBe('bytes 100-199/1000');
    expect(partial.headers['content-type']).toBe('video/webm;codecs=vp8,opus');
    expect(Buffer.compare(partial.body as Buffer, bytes.subarray(100, 200))).toBe(0);

    await http.get(`/api/sessions/${session.id}/recordings/${seg}`).expect(401); // no identity
    await http.get(`/api/sessions/${session.id}/recordings/nope00000000`).set(AUTH).expect(404);
    const other = await newSession('Other Session');
    await http.get(`/api/sessions/${other.session.id}/recordings/${seg}`).set(AUTH).expect(404); // wrong session
    await http.get(`${cand}/recordings/${seg}`).expect(404);
    await http.get(`${cand}/recordings/${seg}/chunks/0`).expect(404);
    const recRow = await prisma.recordingSegment.findUniqueOrThrow({ where: { id: seg } });
    await http.get(`/api/candidate/${recRow.path}`).expect(404);
    await prisma.recordingSegment.update({ where: { id: seg }, data: { deletedAt: new Date() } });
    await http.get(`/api/sessions/${session.id}/recordings/${seg}`).set(AUTH).expect(404); // deleted
    const s = (await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session;
    expect(s.recording.segments).toEqual([]);
  });

  it('decisionAt is set when the decision is made and cleared when it is withdrawn', async () => {
    const { candidate } = await newSession('Decision Case');
    expect(candidate.decisionAt).toBeNull();
    let d = (await http.patch(`/api/candidates/${candidate.id}`).set(AUTH).send({ overallDecision: 'Offer' }).expect(200)).body as CandidateDetail;
    expect(d.overallDecision).toBe('Offer');
    expect(d.decisionAt).toBeTruthy();
    const at = d.decisionAt;
    d = (await http.patch(`/api/candidates/${candidate.id}`).set(AUTH).send({ notes: 'unchanged decision' }).expect(200)).body as CandidateDetail;
    expect(d.decisionAt).toBe(at);
    d = (await http.patch(`/api/candidates/${candidate.id}`).set(AUTH).send({ overallDecision: 'Offer' }).expect(200)).body as CandidateDetail;
    expect(d.decisionAt).toBe(at); // same value: clock not restarted
    d = (await http.patch(`/api/candidates/${candidate.id}`).set(AUTH).send({ overallDecision: 'Reject' }).expect(200)).body as CandidateDetail;
    expect(d.decisionAt).not.toBe(at);
    d = (await http.patch(`/api/candidates/${candidate.id}`).set(AUTH).send({ overallDecision: null }).expect(200)).body as CandidateDetail;
    expect(d.overallDecision).toBeNull();
    expect(d.decisionAt).toBeNull();
  });

  it('retention deletes files for decisions older than N days, keeps newer ones, and marks segments deleted', async () => {
    const make = async (name: string) => {
      const x = await newSession(name);
      await http.post(`${x.cand}/consent`).send({ accepted: true }).expect(200);
      const seg = (await http.post(`${x.cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' }).expect(201)).body.segmentId as string;
      await putChunk(x.cand, seg, 0, randomBytes(64)).expect(200);
      const row = await prisma.recordingSegment.findUniqueOrThrow({ where: { id: seg } });
      return { ...x, seg, path: row.path };
    };
    const old = await make('Old Decision');
    const fresh = await make('Fresh Decision');
    const undecidedOld = await make('Undecided Old');
    const undecidedRecent = await make('Undecided Recent');
    const now = Date.now();
    await prisma.candidate.update({ where: { id: old.candidate.id }, data: { overallDecision: 'Reject', decisionAt: new Date(now - 91 * DAY) } });
    await prisma.candidate.update({ where: { id: fresh.candidate.id }, data: { overallDecision: 'Reject', decisionAt: new Date(now - 89 * DAY) } });
    await prisma.session.update({ where: { id: undecidedOld.session.id }, data: { status: 'completed', endedAt: new Date(now - 366 * DAY) } });
    await prisma.session.update({ where: { id: undecidedRecent.session.id }, data: { status: 'completed', endedAt: new Date(now - 300 * DAY) } });

    const result = await recordings.runRetention();
    expect(result).toEqual({ deleted: 2, failed: 0 });
    expect(existsSync(old.path)).toBe(false);
    expect(existsSync(undecidedOld.path)).toBe(false);
    expect(existsSync(fresh.path)).toBe(true);
    expect(existsSync(undecidedRecent.path)).toBe(true);
    const rows = await prisma.recordingSegment.findMany({ where: { id: { in: [old.seg, fresh.seg, undecidedOld.seg, undecidedRecent.seg] } } });
    const deleted = Object.fromEntries(rows.map((r) => [r.id, !!r.deletedAt]));
    expect(deleted).toEqual({ [old.seg]: true, [fresh.seg]: false, [undecidedOld.seg]: true, [undecidedRecent.seg]: false });
    await http.get(`/api/sessions/${old.session.id}/recordings/${old.seg}`).set(AUTH).expect(404);
    await http.get(`/api/sessions/${fresh.session.id}/recordings/${fresh.seg}`).set(AUTH).expect(200);
    const detail = (await http.get(`/api/candidates/${old.candidate.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(detail.latest.A.recorded).toBe(false);
    expect((await http.get(`/api/candidates/${fresh.candidate.id}`).set(AUTH).expect(200)).body.latest.A.recorded).toBe(true);
    expect(await recordings.runRetention()).toEqual({ deleted: 0, failed: 0 }); // idempotent
  });
});
