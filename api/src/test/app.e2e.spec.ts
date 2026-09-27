import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-setup';
import type { CandidateDetail, CandidateState, Kit, Session } from '../contracts/api';
import { PrismaService } from '../prisma/prisma.service';
import { seedKitFile } from '../seed/seed-kit';

const API_DIR = resolve(__dirname, '../..');
const FIXTURE = resolve(API_DIR, '../kit/fixtures/sample.seed.json');
const AUTH = { 'cf-access-authenticated-user-email': 'tester@example.com' };
const SECRET_FRAGMENTS = ['STDEV.S', 'Mean and standard deviation', 'Bonus:', 'rubric', 'modelAnswer', 'trapOrBonus', 'title'];

describe('talent-os API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { cwd: API_DIR, env: process.env, stdio: 'ignore' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Organization","Job","Kit","Question","Candidate","Application","Session","Response","Rating","RecordingSegment","SessionEvent" CASCADE',
    );
    await seedKitFile(prisma, FIXTURE, { orgSlug: 'g20' });
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health is public', async () => {
    await http.get('/api/health').expect(200, { ok: true });
  });

  it('GET /api/me without identity → 401; with header → email + org', async () => {
    await http.get('/api/me').expect(401);
    const res = await http.get('/api/me').set(AUTH).expect(200);
    expect(res.body).toMatchObject({ email: 'tester@example.com', org: { name: 'G-20 Group' } });
  });

  it('seeding twice is a no-op; --force preserves bands', async () => {
    const again = await seedKitFile(prisma, FIXTURE, { orgSlug: 'g20' });
    expect(again.action).toBe('unchanged');
    await http
      .put('/api/kit/sections/A/bands')
      .set(AUTH)
      .send([{ min: 11, label: 'Top' }, { min: 9, label: 'Pass' }])
      .expect(200);
    const forced = await seedKitFile(prisma, FIXTURE, { orgSlug: 'g20', force: true });
    expect(forced.action).toBe('updated');
    const kit = (await http.get('/api/kit').set(AUTH).expect(200)).body as Kit;
    const a = kit.sections.find((s) => s.key === 'A')!;
    expect(a.bands).toEqual([{ min: 9, label: 'Pass' }, { min: 11, label: 'Top' }]);
    expect(a.questionKeys).toEqual(['A1', 'A2', 'A3', 'A4']);
    await http.put('/api/kit/sections/A/bands').set(AUTH).send([{ min: 9, label: 'Pass — progress' }]).expect(200);
    await http.put('/api/kit/sections/A/bands').set(AUTH).send([{ min: -1, label: 'x' }]).expect(400);
    await http.put('/api/kit/sections/ZZ/bands').set(AUTH).send([]).expect(404);
  });

  it('runs a full Set A interview with a leak-free candidate view', async () => {
    const candidate = (
      await http.post('/api/candidates').set(AUTH).send({ name: 'Ada Lovelace', email: 'ada@example.com', source: 'referral' }).expect(201)
    ).body as CandidateDetail;
    expect(candidate.applicationId).toBeTruthy();
    await http.post('/api/candidates').set(AUTH).send({}).expect(400);

    let session = (await http.post('/api/sessions').set(AUTH).send({ candidateId: candidate.id, section: 'A' }).expect(201)).body as Session;
    expect(session.status).toBe('ready');
    expect(session.candidateUrl).toMatch(/^http:\/\/test\.local\/c\/[A-Za-z0-9_-]{32}$/);
    expect(session.interviewer).toBe('tester@example.com');
    expect(session.verdict).toMatchObject({ total: 0, max: 12, complete: false });
    await http.post('/api/sessions').set(AUTH).send({ candidateId: candidate.id, section: 'NOPE' }).expect(400);
    await http.post('/api/sessions').set(AUTH).send({ candidateId: 'nope', section: 'A' }).expect(404);

    const token = session.candidateUrl!.split('/c/')[1];
    const stateUrl = `/api/candidate/${token}/state`;
    let state = (await http.get(stateUrl).expect(200)).body as CandidateState;
    expect(state).toMatchObject({ phase: 'waiting', question: null, instructions: null, sectionLabel: 'Written test — Part A' });
    await http.get('/api/candidate/not-a-real-token-00000000/state').expect(404);

    session = (await http.post(`/api/sessions/${session.id}/start`).set(AUTH).expect(201)).body as Session;
    expect(session.status).toBe('live');
    expect(session.startedAt).toBeTruthy();
    state = (await http.get(stateUrl).expect(200)).body as CandidateState;
    expect(state.phase).toBe('intro');
    expect(state.instructions).toContain('Show your working');

    session = (await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A1' }).expect(201)).body as Session;
    expect(session.presentedQuestionKey).toBe('A1');
    const res = await http.get(stateUrl).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    state = res.body as CandidateState;
    expect(Object.keys(state).sort()).toEqual([
      'answer', 'instructions', 'orgName', 'phase', 'presentedAt', 'question', 'recording', 'sectionEndsAt', 'sectionLabel', 'serverNow', 'version',
    ]);
    expect(state.phase).toBe('question');
    expect(state.question).toMatchObject({ position: 1, total: 4, timeMinutes: 4 });
    expect(state.question!.prompt).toContain('five daily returns');
    expect(state.question!.dataset!.text).toContain('day,return_pct');
    expect(Object.keys(state.question!).sort()).toEqual(['code', 'dataset', 'position', 'prompt', 'timeMinutes', 'total']);
    const json = JSON.stringify(state);
    for (const fragment of SECRET_FRAGMENTS) expect(json).not.toContain(fragment);
    expect(json).not.toContain('A1');

    await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'S1.1' }).expect(400);
    session = (await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A2' }).expect(201)).body as Session;
    const a1 = session.responses.find((r) => r.questionKey === 'A1');
    expect(a1).toBeDefined();
    expect(a1!.timeSpentSeconds).toBeGreaterThanOrEqual(0);

    for (const [key, score] of [['A1', 3], ['A2', 3], ['A3', 2], ['A4', 2]] as const) {
      session = (
        await http.put(`/api/sessions/${session.id}/responses/${key}`).set(AUTH).send({ score, trapNoticed: key === 'A2' }).expect(200)
      ).body as Session;
    }
    await http.put(`/api/sessions/${session.id}/responses/A1`).set(AUTH).send({ score: 4 }).expect(400);
    await http.put(`/api/sessions/${session.id}/responses/B9`).set(AUTH).send({ score: 1 }).expect(404);
    expect(session.verdict).toMatchObject({ total: 10, max: 12, scored: 4, complete: true, result: 'Pass — progress' });
    expect(session.verdict!.subtotals).toEqual([
      { domain: 'quant', label: 'Quant', total: 6, max: 6 },
      { domain: 'python', label: 'Python', total: 4, max: 6 },
    ]);

    await http.put(`/api/sessions/${session.id}/ratings/1`).set(AUTH).send({ rating: 3 }).expect(404); // rubric section
    session = (await http.patch(`/api/sessions/${session.id}`).set(AUTH).send({ setNotes: 'solid' }).expect(200)).body as Session;
    expect(session.setNotes).toBe('solid');
    await http.patch(`/api/sessions/${session.id}`).set(AUTH).send({ recommendation: 'Proceed' }).expect(400);

    session = (await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(201)).body as Session;
    expect(session.status).toBe('completed');
    expect(session.endedAt).toBeTruthy();
    expect(session.presentedQuestionKey).toBeNull();
    state = (await http.get(stateUrl).expect(200)).body as CandidateState;
    expect(state).toMatchObject({ phase: 'ended', question: null });
    await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'A1' }).expect(409);
    await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(409);
    session = (await http.post(`/api/sessions/${session.id}/reopen`).set(AUTH).expect(201)).body as Session;
    expect(session.status).toBe('live');
    session = (await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(201)).body as Session;

    const detail = (await http.get(`/api/candidates/${candidate.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(detail.stageReached).toBe(2);
    expect(detail.latest.A).toMatchObject({ status: 'completed', trapsNoticed: 1, superseded: false });
    expect(detail.latest.A.verdict!.result).toBe('Pass — progress');

    // Re-sit: the old session is retained and marked superseded.
    await http.post('/api/sessions').set(AUTH).send({ candidateId: candidate.id, section: 'A' }).expect(201);
    const resat = (await http.get(`/api/candidates/${candidate.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(resat.sessions).toHaveLength(2);
    expect(resat.sessions[1].superseded).toBe(true);
    expect(resat.latest.A.status).toBe('ready');

    const list = (await http.get('/api/candidates').set(AUTH).expect(200)).body as CandidateDetail[];
    expect(list.map((c) => c.id)).toContain(candidate.id);

    const csv = await http.get('/api/export/candidates.csv').set(AUTH).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.text).toContain('A_total,A_quant,A_python,A_traps,A_bonuses,A_result');
    expect(csv.text).toContain('Ada Lovelace');

    const scorecard = await http.get(`/api/export/candidates/${candidate.id}.json`).set(AUTH).expect(200);
    expect(scorecard.headers['content-disposition']).toContain('attachment');
    expect(JSON.parse(scorecard.text)).toMatchObject({ kit: { slug: 'sample' }, candidate: { id: candidate.id } });
    expect(JSON.parse(scorecard.text).sessions).toHaveLength(2);
  });

  it('dimension sections: ratings + recommendation, and no candidate view', async () => {
    const candidate = (await http.post('/api/candidates').set(AUTH).send({ name: 'Grace Hopper' }).expect(201)).body as CandidateDetail;
    let session = (await http.post('/api/sessions').set(AUTH).send({ candidateId: candidate.id, section: 'S1' }).expect(201)).body as Session;
    expect(session.candidateUrl).toBeNull();
    expect(session.verdict).toBeNull();
    const token = (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).candidateToken;
    await http.get(`/api/candidate/${token}/state`).expect(404);

    session = (await http.put(`/api/sessions/${session.id}/ratings/5`).set(AUTH).send({ rating: 4, note: 'clear' }).expect(200)).body as Session;
    expect(session.ratings).toEqual([{ dimensionId: 5, rating: 4, note: 'clear' }]);
    await http.put(`/api/sessions/${session.id}/ratings/5`).set(AUTH).send({ rating: 6 }).expect(400);
    await http.put(`/api/sessions/${session.id}/ratings/2`).set(AUTH).send({ rating: 3 }).expect(404);
    session = (await http.patch(`/api/sessions/${session.id}`).set(AUTH).send({ recommendation: 'Proceed' }).expect(200)).body as Session;
    expect(session.recommendation).toBe('Proceed');

    const csv = await http.get('/api/export/candidates.csv').set(AUTH).expect(200);
    const row = csv.text.split('\r\n').find((l) => l.includes('Grace Hopper'))!;
    const header = csv.text.split('\r\n')[0].split(',');
    const cells = row.split(',');
    expect(cells[header.indexOf('S1_dim5')]).toBe('4');
    expect(cells[header.indexOf('S1_recommendation')]).toBe('Proceed');
  });
});
