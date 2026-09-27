/**
 * v1.3 e2e: cancelling an unused candidate link. Runs against a real Postgres.
 * ready → cancelled; the token then answers 404 everywhere; device-check footage is deleted;
 * summaries, exports and jobs treat a cancelled session as one that never ran.
 */
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-setup';
import type { CandidateDetail, CandidateScorecard, Session } from '../contracts/api';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingsService } from '../recordings/recordings.service';
import { seedKitFile } from '../seed/seed-kit';
import { SessionsService } from '../sessions/sessions.service';

const API_DIR = resolve(__dirname, '../..');
const FIXTURE = resolve(API_DIR, '../kit/fixtures/sample.seed.json');
const AUTH = { 'cf-access-authenticated-user-email': 'tester@example.com' };
const OCTET = { 'Content-Type': 'application/octet-stream' };

describe('cancel link (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let recordings: RecordingsService;
  let jobs: SessionsService;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { cwd: API_DIR, env: process.env, stdio: 'ignore' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    recordings = app.get(RecordingsService);
    jobs = app.get(SessionsService);
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

  async function newCandidate(name: string): Promise<CandidateDetail> {
    return (await http.post('/api/candidates').set(AUTH).send({ name }).expect(201)).body as CandidateDetail;
  }

  async function newSession(candidateId: string, section = 'A'): Promise<{ session: Session; token: string; cand: string }> {
    const session = (await http.post('/api/sessions').set(AUTH).send({ candidateId, section }).expect(201)).body as Session;
    const token = session.candidateUrl!.split('/c/')[1];
    return { session, token, cand: `/api/candidate/${token}` };
  }

  /** Runs a Set A session to completion with one score. */
  async function completeSetA(candidateId: string): Promise<Session> {
    const { session } = await newSession(candidateId);
    await http.post(`/api/sessions/${session.id}/start`).set(AUTH).expect(201);
    await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A1' }).expect(201);
    await http.put(`/api/sessions/${session.id}/responses/A1`).set(AUTH).send({ score: 3 }).expect(200);
    const done = (await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(201)).body as Session;
    expect(done.status).toBe('completed');
    return done;
  }

  it('ready → cancelled (endedAt set, version bumped); live, completed and cancelled → 409 not_ready; unknown → 404; protected', async () => {
    const c = await newCandidate('Cancel Ready');
    const { session } = await newSession(c.id);
    const before = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });

    const cancelled = (await http.post(`/api/sessions/${session.id}/cancel`).set(AUTH).expect(200)).body as Session;
    expect(cancelled).toMatchObject({ id: session.id, status: 'cancelled', startedAt: null, presentedQuestionKey: null });
    expect(cancelled.endedAt).toBeTruthy();
    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.version).toBe(before.version + 1);
    expect(((await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session).status).toBe('cancelled');

    // Cancelled is final: no other transition applies.
    expect((await http.post(`/api/sessions/${session.id}/cancel`).set(AUTH).expect(409)).body).toMatchObject({ reason: 'not_ready' });
    await http.post(`/api/sessions/${session.id}/start`).set(AUTH).expect(409);
    await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A1' }).expect(409);
    await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(409);
    await http.post(`/api/sessions/${session.id}/reopen`).set(AUTH).expect(409);
    await http.post(`/api/sessions/${session.id}/extend`).set(AUTH).send({ minutes: 5 }).expect(409);
    expect(((await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session).status).toBe('cancelled');

    const live = await newSession(c.id);
    await http.post(`/api/sessions/${live.session.id}/start`).set(AUTH).expect(201);
    expect((await http.post(`/api/sessions/${live.session.id}/cancel`).set(AUTH).expect(409)).body).toMatchObject({ reason: 'not_ready' });
    await http.get(`${live.cand}/state`).expect(200); // the live link keeps working
    const done = (await http.post(`/api/sessions/${live.session.id}/end`).set(AUTH).expect(201)).body as Session;
    expect(done.status).toBe('completed');
    expect((await http.post(`/api/sessions/${live.session.id}/cancel`).set(AUTH).expect(409)).body).toMatchObject({ reason: 'not_ready' });

    await http.post('/api/sessions/nope/cancel').set(AUTH).expect(404);
    await http.post(`/api/sessions/${session.id}/cancel`).expect(401); // no identity
  });

  it('every candidate endpoint answers 404 for a cancelled token, exactly like an unknown token', async () => {
    const c = await newCandidate('Cancel Token');
    const { session, cand } = await newSession(c.id);
    await http.get(`${cand}/state`).expect(200);
    await http.post(`${cand}/consent`).send({ accepted: true }).expect(200);
    const seg = (await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' }).expect(201)).body.segmentId as string;
    await http.post(`/api/sessions/${session.id}/cancel`).set(AUTH).expect(200);

    const calls: Array<[string, () => request.Test]> = [
      ['state', () => http.get(`${cand}/state`)],
      ['consent', () => http.post(`${cand}/consent`).send({ accepted: true })],
      ['answer', () => http.put(`${cand}/answer`).send({ position: 1, text: 'x' })],
      ['choice', () => http.put(`${cand}/choice`).send({ position: 1, choice: 0 })],
      ['recordings', () => http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' })],
      ['chunks', () => http.put(`${cand}/recordings/${seg}/chunks/0`).set(OCTET).send(randomBytes(64))],
      ['stop', () => http.post(`${cand}/recordings/${seg}/stop`)],
      ['events', () => http.post(`${cand}/events`).send({ events: [{ type: 'tab_hidden', clientAt: new Date().toISOString() }] })],
      ['start', () => http.post(`${cand}/start`)],
      ['navigate', () => http.post(`${cand}/navigate`).send({ position: 1 })],
      ['submit', () => http.post(`${cand}/submit`)],
      ['quote', () => http.put(`${cand}/quote`).send({ bid: 1, ask: 2, size: 1 })],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      expect(`${name} → ${res.status}`).toBe(`${name} → 404`);
    }
    // Same body as an unknown token: nothing hints that the token ever existed.
    const unknown = await http.get('/api/candidate/not-a-real-token-00000000/state').expect(404);
    const gone = await http.get(`${cand}/state`).expect(404);
    expect(gone.body).toEqual(unknown.body);
    expect(JSON.stringify(gone.body)).not.toContain('cancel');
  });

  it('cancel deletes footage uploaded during the device check and marks the segments deleted; jobs have nothing left to do', async () => {
    const c = await newCandidate('Cancel Footage');
    const { session, cand } = await newSession(c.id);
    await http.post(`${cand}/consent`).send({ accepted: true }).expect(200);
    const camera = (await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' }).expect(201)).body.segmentId as string;
    const screen = (await http.post(`${cand}/recordings`).send({ stream: 'screen', mimeType: 'video/webm' }).expect(201)).body.segmentId as string;
    await http.put(`${cand}/recordings/${camera}/chunks/0`).set(OCTET).send(randomBytes(2048)).expect(200);
    await http.put(`${cand}/recordings/${screen}/chunks/0`).set(OCTET).send(randomBytes(1024)).expect(200);
    const rows = await prisma.recordingSegment.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(existsSync(r.path)).toBe(true);
    let s = (await http.get(`/api/sessions/${session.id}`).set(AUTH).expect(200)).body as Session;
    expect(s.recording.segments).toHaveLength(2);

    s = (await http.post(`/api/sessions/${session.id}/cancel`).set(AUTH).expect(200)).body as Session;
    expect(s.status).toBe('cancelled');
    expect(s.recording.segments).toEqual([]);
    for (const r of rows) {
      expect(existsSync(r.path)).toBe(false);
      expect(existsSync(`${r.path}.tmp`)).toBe(false);
      expect((await prisma.recordingSegment.findUniqueOrThrow({ where: { id: r.id } })).deletedAt).toBeTruthy();
      await http.get(`/api/sessions/${session.id}/recordings/${r.id}`).set(AUTH).expect(404);
    }
    const detail = (await http.get(`/api/candidates/${c.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(detail.sessions[0]).toMatchObject({ id: session.id, status: 'cancelled', recorded: false });

    // Retention finds nothing left for the cancelled session; the self-paced job ignores it.
    expect(await recordings.runRetention()).toEqual({ deleted: 0, failed: 0 });
    expect(await jobs.completeExpiredSelfPaced()).toBe(0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('cancelled');
  });

  it('summaries: a cancelled newer session is listed but never latest, never supersedes, never counts towards the stage', async () => {
    const c = await newCandidate('Cancel Summary');
    const done = await completeSetA(c.id);
    const { session: voided } = await newSession(c.id);
    await http.post(`/api/sessions/${voided.id}/cancel`).set(AUTH).expect(200);

    const detail = (await http.get(`/api/candidates/${c.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(detail.sessions.map((x) => [x.id, x.status, x.superseded])).toEqual([
      [voided.id, 'cancelled', false],
      [done.id, 'completed', false],
    ]);
    expect(detail.latest.A).toMatchObject({ id: done.id, status: 'completed', superseded: false });
    expect(detail.stageReached).toBe(2);

    // A real re-sit still supersedes the completed one; the cancelled row stays as it is.
    const { session: resit } = await newSession(c.id);
    const again = (await http.get(`/api/candidates/${c.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(again.latest.A).toMatchObject({ id: resit.id, status: 'ready' });
    expect(again.sessions.find((x) => x.id === done.id)!.superseded).toBe(true);
    expect(again.sessions.find((x) => x.id === voided.id)!.superseded).toBe(false);

    // Only a cancelled session: nothing reached, nothing latest — in the list and in the detail.
    const only = await newCandidate('Cancel Only');
    const { session: onlyVoided } = await newSession(only.id);
    await http.post(`/api/sessions/${onlyVoided.id}/cancel`).set(AUTH).expect(200);
    const list = (await http.get('/api/candidates').set(AUTH).expect(200)).body as CandidateDetail[];
    expect(list.find((x) => x.id === only.id)).toMatchObject({ stageReached: 0, latest: {} });
    const onlyDetail = (await http.get(`/api/candidates/${only.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(onlyDetail.sessions.map((x) => x.status)).toEqual(['cancelled']);

    // CSV ignores cancelled sessions; the JSON scorecard lists them with their status.
    const lines = (await http.get('/api/export/candidates.csv').set(AUTH).expect(200)).text.split('\r\n');
    const header = lines[0].split(',');
    const cells = lines.find((l) => l.includes('Cancel Only'))!.split(',');
    expect(cells[header.indexOf('stage_reached')]).toBe('0');
    expect(cells[header.indexOf('A_total')]).toBe('');
    expect(cells[header.indexOf('A_result')]).toBe('');
    const scorecard = JSON.parse((await http.get(`/api/export/candidates/${c.id}.json`).set(AUTH).expect(200)).text) as CandidateScorecard;
    expect(scorecard.sessions.map((x) => x.status).sort()).toEqual(['cancelled', 'completed', 'ready']);
    expect(scorecard.sessions.find((x) => x.id === voided.id)).toMatchObject({ status: 'cancelled', startedAt: null });
    expect(scorecard.candidate.latest.A.id).toBe(resit.id);
  });
});
