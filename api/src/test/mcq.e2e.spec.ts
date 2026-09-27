/**
 * v1.2 e2e: multiple-choice, auto-scored, self-paced sections. Runs against a real Postgres.
 * The kit is the synthetic sample fixture plus two synthetic mcq sections built in memory.
 */
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-setup';
import type { CandidateDetail, CandidateState, Kit, Session } from '../contracts/api';
import type { KitSeed, QuestionSeed, SectionSeed } from '../contracts/kit-seed';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingsService } from '../recordings/recordings.service';
import { seedKit, validateKitSeed } from '../seed/seed-kit';
import { SessionsService } from '../sessions/sessions.service';

process.env.CANDIDATE_BRAND = 'BTNET'; // candidates see the brand, never the org name

const API_DIR = resolve(__dirname, '../..');
const FIXTURE = resolve(API_DIR, '../kit/fixtures/sample.seed.json');
const AUTH = { 'cf-access-authenticated-user-email': 'tester@example.com' };

const STATE_KEYS = [
  'answer', 'answeredPositions', 'instructions', 'market', 'marking', 'orgName', 'phase', 'presentedAt', 'question', 'recording',
  'sectionEndsAt', 'sectionLabel', 'selfPaced', 'serverNow', 'version',
];
const QUESTION_KEYS = ['choices', 'code', 'dataset', 'position', 'prompt', 'timeMinutes', 'total'];
const ANSWER_KEYS = ['choice', 'savedAt', 'text'];

const MARKING = { correct: 1, wrong: -0.25, blank: 0 };

function mcqSection(key: string, selfPaced: boolean, shuffle: boolean): SectionSeed {
  return {
    key,
    stage: 2,
    label: `Set ${key} — Multiple choice (SECRET-LABEL)`,
    candidateLabel: `Written test — Part ${key}`,
    scoring: 'auto',
    timeMinutes: 10,
    maxScore: null,
    bands: [{ min: 2.5, label: 'Pass' }, { min: 4, label: 'Strong' }],
    dimensionIds: [],
    recommendationOptions: [],
    domainGroups: [
      { domain: 'math', label: 'Maths' },
      { domain: 'probability', label: 'Probability' },
    ],
    candidateView: true,
    showInstructions: true,
    interviewerNotes: null,
    selfPaced,
    shuffle,
    autoScoring: MARKING,
    candidateInstructions: `Pick one option per question in Part ${key}.`,
  };
}

function mcqQuestion(section: string, n: number): QuestionSeed {
  const choices = ['alpha', 'bravo', 'charlie', 'delta'].map((c) => `${section}${n}-${c}`);
  return {
    key: `${section}${n}`,
    section,
    stage: 2,
    number: n,
    title: `SECRET-TITLE ${section}${n}`,
    domain: n <= 3 ? 'math' : 'probability',
    difficulty: 'easy',
    mode: 'mcq',
    timeMinutes: 2,
    prompt: `Question ${section} number ${n}: which option is right?`,
    dataset: null,
    code: null,
    modelAnswer: `SECRET-MODEL ${section}${n}`,
    rubric: null,
    trapOrBonus: null,
    whatGoodLooksLike: null,
    choices,
    correctChoice: n % 4,
    market: null,
  };
}

function buildSeed(version: string): KitSeed {
  const base = JSON.parse(readFileSync(FIXTURE, 'utf8')) as KitSeed;
  const questions: QuestionSeed[] = [];
  for (let n = 1; n <= 5; n++) questions.push(mcqQuestion('M', n));
  for (let n = 1; n <= 2; n++) questions.push(mcqQuestion('L', n));
  return {
    ...base,
    version,
    sections: [...base.sections, mcqSection('M', true, true), mcqSection('L', false, false)],
    questions: [...base.questions, ...questions],
  };
}

describe('v1.2 multiple choice + self-paced (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let kit: Kit;

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
    await seedKit(prisma, buildSeed('1.0'), { orgSlug: 'g20' });
    http = request(app.getHttpServer());
    kit = (await http.get('/api/kit').set(AUTH).expect(200)).body as Kit;
  });

  afterAll(async () => {
    await app.get(RecordingsService).drain();
    await app.close();
    rmSync(process.env.RECORDINGS_DIR!, { recursive: true, force: true });
  });

  async function newCandidate(name: string): Promise<CandidateDetail> {
    return (await http.post('/api/candidates').set(AUTH).send({ name }).expect(201)).body as CandidateDetail;
  }

  async function newSession(candidateId: string, section: string, extra: Record<string, unknown> = {}) {
    const session = (await http.post('/api/sessions').set(AUTH).send({ candidateId, section, ...extra }).expect(201)).body as Session;
    const token = session.candidateUrl!.split('/c/')[1];
    return { session, cand: `/api/candidate/${token}` };
  }

  const getSession = async (id: string) => (await http.get(`/api/sessions/${id}`).set(AUTH).expect(200)).body as Session;
  const getState = async (cand: string) => (await http.get(`${cand}/state`).expect(200)).body as CandidateState;

  function assertLeakFree(state: CandidateState): void {
    expect(Object.keys(state).sort()).toEqual(STATE_KEYS);
    const json = JSON.stringify(state);
    expect(json).not.toContain('correctChoice');
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('G-20');
    expect(state.orgName).toBe('BTNET');
    expect(json).not.toContain('"market":{');
    expect(json).not.toMatch(/"[ML]\d"/); // no question keys
    if (state.question) expect(Object.keys(state.question).sort()).toEqual(QUESTION_KEYS);
    if (state.answer) expect(Object.keys(state.answer).sort()).toEqual(ANSWER_KEYS);
  }

  it('seeder: v1.2 fields validated and defaulted; GET /api/kit carries choices/correctChoice on the interviewer side', () => {
    const m = kit.sections.find((s) => s.key === 'M')!;
    expect(m).toMatchObject({ scoring: 'auto', selfPaced: true, shuffle: true, autoScoring: MARKING, candidateInstructions: 'Pick one option per question in Part M.' });
    expect(kit.sections.find((s) => s.key === 'A')).toMatchObject({ selfPaced: false, shuffle: false, autoScoring: null, candidateInstructions: null });
    const m2 = kit.questions.find((q) => q.key === 'M2')!;
    expect(m2.choices).toEqual(['M2-alpha', 'M2-bravo', 'M2-charlie', 'M2-delta']);
    expect(m2.correctChoice).toBe(2);
    expect(m2.market).toBeNull();
    expect(kit.questions.find((q) => q.key === 'A1')).toMatchObject({ choices: null, correctChoice: null, market: null });

    const bad = buildSeed('9.9');
    const q = bad.questions.find((x) => x.key === 'M1')!;
    q.choices = ['same', 'same'];
    expect(() => validateKitSeed(bad)).toThrow(/unique/);
    q.choices = ['a', 'b'];
    q.correctChoice = 2;
    expect(() => validateKitSeed(bad)).toThrow(/correctChoice/);
    q.correctChoice = 0;
    q.mode = 'market';
    q.choices = null;
    q.correctChoice = null;
    q.market = { kind: 'dice', dice: 0, sides: 6 };
    expect(() => validateKitSeed(bad)).toThrow(/market\.dice/);
    q.market = { kind: 'estimate', trueValue: 42, unit: 'kg', hints: ['h1'] };
    expect(() => validateKitSeed(bad)).not.toThrow();
  });

  it('self-paced mcq: start gates, navigate, shuffled choices map back, negative marking, submit', async () => {
    const candidate = await newCandidate('Mary Cartwright');
    const { session, cand } = await newSession(candidate.id, 'M');
    expect(session.recording.required).toBe(true);
    expect(session.questionOrder).toHaveLength(5);
    expect([...session.questionOrder!].sort()).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(session.transcript).toEqual({ status: 'none', model: null, noteModel: null, updatedAt: null, error: null, lines: [] });
    expect(session.market).toBeNull();
    expect(session.verdict).toMatchObject({ total: 0, max: 5, scored: 0, skipped: 5, complete: false });

    let state = await getState(cand);
    assertLeakFree(state);
    expect(state).toMatchObject({ phase: 'waiting', selfPaced: true, marking: MARKING, answeredPositions: [], market: null });

    // The interviewer cannot drive a self-paced section.
    expect((await http.post(`/api/sessions/${session.id}/start`).set(AUTH).expect(409)).body).toMatchObject({ reason: 'self_paced' });
    expect((await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'M1' }).expect(409)).body).toMatchObject({ reason: 'self_paced' });

    // Start gates: consent, then camera AND screen.
    expect((await http.post(`${cand}/start`).expect(409)).body).toMatchObject({ reason: 'consent_required' });
    await http.post(`${cand}/consent`).send({ accepted: true }).expect(200);
    expect((await http.post(`${cand}/start`).expect(409)).body).toMatchObject({ reason: 'devices_required' });
    await http.post(`${cand}/recordings`).send({ stream: 'camera', mimeType: 'video/webm' }).expect(201);
    expect((await http.post(`${cand}/start`).expect(409)).body).toMatchObject({ reason: 'devices_required' });
    await http.post(`${cand}/recordings`).send({ stream: 'screen', mimeType: 'video/webm' }).expect(201);
    await http.put(`${cand}/choice`).send({ position: 1, choice: 0 }).expect(409); // not live yet
    state = (await http.post(`${cand}/start`).expect(200)).body as CandidateState;
    assertLeakFree(state);
    // Start opens the candidate's first question (their own shuffled order).
    expect(state).toMatchObject({ phase: 'question', instructions: null, selfPaced: true });
    expect(state.question?.position).toBe(1);
    expect(state.sectionEndsAt).toBeTruthy();
    let s = await getSession(session.id);
    expect(s.status).toBe('live');
    expect(s.startedAt).toBeTruthy();

    // Walk the section in display order: 1–3 right, 4 wrong, 5 blank.
    const order = s.questionOrder!;
    for (let position = 1; position <= 5; position++) {
      state = (await http.post(`${cand}/navigate`).send({ position }).expect(200)).body as CandidateState;
      assertLeakFree(state);
      expect(state.phase).toBe('question');
      expect(state.question).toMatchObject({ position, total: 5, timeMinutes: 2 });
      const canonical = kit.questions.find((q) => q.key === order[position - 1])!;
      expect(state.question!.prompt).toBe(canonical.prompt);
      expect([...state.question!.choices!].sort()).toEqual([...canonical.choices!].sort());
      const displayedCorrect = state.question!.choices!.indexOf(canonical.choices![canonical.correctChoice!]);
      expect(displayedCorrect).toBeGreaterThanOrEqual(0);
      expect(state.answer).toEqual({ text: '', savedAt: null, choice: null });
      if (position === 5) continue;
      const choice = position <= 3 ? displayedCorrect : (displayedCorrect + 1) % 4;
      await http.put(`${cand}/choice`).send({ position, choice: 9 }).expect(400);
      const saved = (await http.put(`${cand}/choice`).send({ position, choice }).expect(200)).body as { savedAt: string };
      expect(saved.savedAt).toBeTruthy();
      state = await getState(cand);
      expect(state.answer).toEqual({ text: '', savedAt: saved.savedAt, choice });
      expect(state.answeredPositions).toEqual(Array.from({ length: position }, (_, i) => i + 1));
    }
    // Choices are stored canonically and scored server-side.
    s = await getSession(session.id);
    for (let position = 1; position <= 4; position++) {
      const key = order[position - 1];
      const canonical = kit.questions.find((q) => q.key === key)!;
      const r = s.responses.find((x) => x.questionKey === key)!;
      if (position <= 3) expect(r.choice).toBe(canonical.correctChoice);
      else expect(r.choice).not.toBe(canonical.correctChoice);
      expect(typeof r.choice).toBe('number');
      expect(r.autoScore).toBe(position <= 3 ? 1 : -0.25);
      expect(r).toMatchObject({ aiDraftNote: null, aiDraftAt: null });
      expect(r.firstPresentedAt).toBeTruthy();
    }
    expect(s.responses.find((x) => x.questionKey === order[4])).toMatchObject({ choice: null, autoScore: null });
    expect(s.verdict).toMatchObject({ total: 2.75, max: 5, scored: 4, skipped: 1, complete: false, result: 'Pass' });
    const mathKeys = order.filter((k) => ['M1', 'M2', 'M3'].includes(k));
    const mathTotal = mathKeys.reduce((acc, k) => {
      const pos = order.indexOf(k) + 1;
      return acc + (pos <= 3 ? 1 : pos === 4 ? -0.25 : 0);
    }, 0);
    expect(s.verdict!.subtotals).toEqual([
      { domain: 'math', label: 'Maths', total: mathTotal, max: 3 },
      { domain: 'probability', label: 'Probability', total: Math.round((2.75 - mathTotal) * 1e6) / 1e6, max: 2 },
    ]);

    // Clearing an answer makes it blank again; re-choosing restores it.
    await http.put(`${cand}/choice`).send({ position: 4, choice: null }).expect(200);
    expect((await getState(cand)).answeredPositions).toEqual([1, 2, 3]);
    expect((await getSession(session.id)).verdict).toMatchObject({ total: 3, scored: 3, skipped: 2 });

    // Submit → completed; the verdict is complete; nothing more can be saved.
    state = (await http.post(`${cand}/submit`).expect(200)).body as CandidateState;
    assertLeakFree(state);
    expect(state).toMatchObject({ phase: 'ended', question: null, answer: null });
    s = await getSession(session.id);
    expect(s.status).toBe('completed');
    expect(s.endedAt).toBeTruthy();
    expect(s.verdict).toMatchObject({ total: 3, complete: true, result: 'Pass' });
    expect((await http.put(`${cand}/choice`).send({ position: 1, choice: 0 }).expect(409)).body).toMatchObject({ reason: 'not_live' });
    await http.post(`${cand}/navigate`).send({ position: 1 }).expect(409);
    await http.post(`${cand}/submit`).expect(200); // idempotent

    const detail = (await http.get(`/api/candidates/${candidate.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(detail.latest.M.verdict).toMatchObject({ total: 3, max: 5, complete: true });
  });

  it('self-paced: time_up after the grace period, auto-complete job ~60 s after sectionEndsAt', async () => {
    const candidate = await newCandidate('Emmy Noether');
    const a = await newSession(candidate.id, 'M', { recordingRequired: false });
    const b = await newSession((await newCandidate('Sophie Germain')).id, 'M', { recordingRequired: false });
    await http.post(`${a.cand}/start`).expect(200);
    await http.post(`${b.cand}/start`).expect(200);
    await http.post(`${a.cand}/navigate`).send({ position: 2 }).expect(200);
    await http.put(`${a.cand}/choice`).send({ position: 2, choice: 1 }).expect(200);

    const jobs = app.get(SessionsService);
    expect(await jobs.completeExpiredSelfPaced()).toBe(0);
    expect((await getSession(a.session.id)).status).toBe('live');

    // Section time (10 min) ran out 30 s ago: answers still save (15 s grace has not... it has) → time_up.
    await prisma.session.update({ where: { id: a.session.id }, data: { startedAt: new Date(Date.now() - 10 * 60_000 - 30_000) } });
    expect((await http.put(`${a.cand}/choice`).send({ position: 2, choice: 0 }).expect(409)).body).toMatchObject({ reason: 'time_up' });
    // Not yet 60 s past the end: the job leaves it alone; 90 s past: completed.
    expect(await jobs.completeExpiredSelfPaced()).toBe(0);
    await prisma.session.update({
      where: { id: a.session.id },
      data: { startedAt: new Date(Date.now() - 10 * 60_000 - 90_000), presentedAt: new Date(Date.now() - 5 * 60_000) },
    });
    expect(await jobs.completeExpiredSelfPaced()).toBe(1);
    const done = await getSession(a.session.id);
    expect(done.status).toBe('completed');
    expect(done.responses.find((r) => r.questionKey === done.questionOrder![1])!.timeSpentSeconds).toBeGreaterThan(0);
    expect(done.verdict!.complete).toBe(true);
    expect((await getState(a.cand)).phase).toBe('ended');
    expect((await getSession(b.session.id)).status).toBe('live');
    expect(await jobs.completeExpiredSelfPaced()).toBe(0);
  });

  it('live (interviewer-driven) mcq: choices only for presented questions, no shuffle', async () => {
    const candidate = await newCandidate('Julia Robinson');
    const { session, cand } = await newSession(candidate.id, 'L', { recordingRequired: false });
    expect(session.questionOrder).toBeNull();
    await http.post(`${cand}/start`).expect(409); // not self-paced
    await http.post(`${cand}/navigate`).send({ position: 1 }).expect(409);
    let s = (await http.post(`/api/sessions/${session.id}/start`).set(AUTH).expect(201)).body as Session;
    expect(s.status).toBe('live');
    let state = await getState(cand);
    expect(state).toMatchObject({ phase: 'intro', selfPaced: false, marking: MARKING, instructions: 'Pick one option per question in Part L.' });
    expect((await http.put(`${cand}/choice`).send({ position: 2, choice: 0 }).expect(409)).body).toMatchObject({ reason: 'not_presented' });
    s = (await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'L1' }).expect(201)).body as Session;
    state = await getState(cand);
    assertLeakFree(state);
    expect(state.question).toMatchObject({ position: 1, total: 2, choices: ['L1-alpha', 'L1-bravo', 'L1-charlie', 'L1-delta'] });
    await http.put(`${cand}/choice`).send({ position: 1, choice: 1 }).expect(200); // L1 correct = 1
    await http.put(`${cand}/choice`).send({ position: 2, choice: 0 }).expect(409); // L2 not presented yet
    s = (await http.post(`/api/sessions/${session.id}/present`).set(AUTH).send({ questionKey: 'L2' }).expect(201)).body as Session;
    await http.put(`${cand}/choice`).send({ position: 1, choice: 0 }).expect(200); // presented earlier: still allowed
    await http.put(`${cand}/choice`).send({ position: 2, choice: 2 }).expect(200); // L2 correct = 2
    s = await getSession(session.id);
    expect(s.responses.map((r) => [r.questionKey, r.choice, r.autoScore])).toEqual([['L1', 0, -0.25], ['L2', 2, 1]]);
    expect(s.verdict).toMatchObject({ total: 0.75, max: 2, scored: 2, skipped: 0, complete: true });
    await http.post(`${cand}/submit`).expect(409);
    s = (await http.post(`/api/sessions/${session.id}/end`).set(AUTH).expect(201)).body as Session;
    expect(s.status).toBe('completed');
  });

  it('a new kit version of the same slug reuses the job: a candidate created under 1.0 runs 1.1', async () => {
    const candidate = await newCandidate('Ada Byron');
    const before = await newSession(candidate.id, 'M', { recordingRequired: false });
    expect(before.session.kitVersion).toBe('1.0');
    const seeded = await seedKit(prisma, buildSeed('1.1'), { orgSlug: 'g20' });
    expect(seeded.action).toBe('created');
    expect(await prisma.job.count({ where: { title: 'Sample Role' } })).toBe(1);
    expect(await prisma.kit.count({ where: { slug: 'sample' } })).toBe(2);
    const after = await newSession(candidate.id, 'M', { recordingRequired: false });
    expect(after.session.kitVersion).toBe('1.1');
    expect(after.session.candidateId).toBe(candidate.id);
    const state = (await http.post(`${after.cand}/start`).expect(200)).body as CandidateState;
    expect(state.phase).toBe('question');
    expect((await getSession(before.session.id)).kitVersion).toBe('1.0'); // old session stays pinned
    const detail = (await http.get(`/api/candidates/${candidate.id}`).set(AUTH).expect(200)).body as CandidateDetail;
    expect(detail.sessions).toHaveLength(2);
    expect(detail.latest.M.id).toBe(after.session.id);
  });
});
