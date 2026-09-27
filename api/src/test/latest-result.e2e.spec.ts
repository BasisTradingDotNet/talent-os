/**
 * Regression (27 Sep 2026): a completed Stage 0 disappeared from a candidate's profile because
 * Start had been clicked again afterwards, and the newest — never used — link became the
 * section's "latest". Only a session that actually ran may be a result or supersede another.
 */
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-setup';
import type { CandidateDetail, Session } from '../contracts/api';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingsService } from '../recordings/recordings.service';
import { seedKitFile } from '../seed/seed-kit';

const API_DIR = resolve(__dirname, '../..');
const FIXTURE = resolve(API_DIR, '../kit/fixtures/sample.seed.json');
const AUTH = { 'cf-access-authenticated-user-email': 'tester@example.com' };

describe('section result selection (e2e)', () => {
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

  const create = async (candidateId: string, section: string): Promise<Session> =>
    (await http.post('/api/sessions').set(AUTH).send({ candidateId, section, recordingRequired: false }).expect(201)).body as Session;
  const detail = async (id: string): Promise<CandidateDetail> =>
    (await http.get(`/api/candidates/${id}`).set(AUTH).expect(200)).body as CandidateDetail;
  const supersededOf = (d: CandidateDetail, id: string) => d.sessions.find((s) => s.id === id)?.superseded;
  const tick = () => new Promise((r) => setTimeout(r, 15)); // distinct createdAt ordering

  it('keeps the completed result when unused links are created after it', async () => {
    const cand = (await http.post('/api/candidates').set(AUTH).send({ name: 'Result Keeper' }).expect(201)).body as CandidateDetail;
    const older = await create(cand.id, 'A');
    await tick();
    const done = await create(cand.id, 'A');
    await http.post(`/api/sessions/${done.id}/start`).set(AUTH).expect(201);
    await http.put(`/api/sessions/${done.id}/responses/A1`).set(AUTH).send({ score: 3 }).expect(200);
    await http.post(`/api/sessions/${done.id}/end`).set(AUTH).expect(201);
    await tick();
    const unused1 = await create(cand.id, 'A');
    await tick();
    const unused2 = await create(cand.id, 'A');

    let d = await detail(cand.id);
    expect(d.latest.A.id).toBe(done.id);
    expect(d.latest.A.status).toBe('completed');
    expect(d.latest.A.verdict?.total).toBe(3);
    expect(supersededOf(d, done.id)).toBe(false);
    expect(supersededOf(d, older.id)).toBe(true); // an unused link older than the result
    expect(supersededOf(d, unused1.id)).toBe(false); // pending links, not superseded…
    expect(supersededOf(d, unused2.id)).toBe(false); // …and not the result either

    // Once a newer link is actually used, it becomes the result and supersedes everything older.
    await http.post(`/api/sessions/${unused2.id}/start`).set(AUTH).expect(201);
    d = await detail(cand.id);
    expect(d.latest.A.id).toBe(unused2.id);
    expect(supersededOf(d, done.id)).toBe(true);
    expect(supersededOf(d, unused1.id)).toBe(true);
  });

  it('uses the newest unused link while nothing has run yet', async () => {
    const cand = (await http.post('/api/candidates').set(AUTH).send({ name: 'Not Started' }).expect(201)).body as CandidateDetail;
    const first = await create(cand.id, 'A');
    await tick();
    const second = await create(cand.id, 'A');
    const d = await detail(cand.id);
    expect(d.latest.A.id).toBe(second.id);
    expect(supersededOf(d, first.id)).toBe(true);
    expect(supersededOf(d, second.id)).toBe(false);
  });
});
