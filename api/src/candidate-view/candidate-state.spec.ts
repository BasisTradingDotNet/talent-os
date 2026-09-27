import { buildCandidateState, CandidateStateInput } from './candidate-state';

const SECRETS = {
  title: 'SECRET-TITLE Mutable default argument',
  modelAnswer: 'SECRET-ANSWER the list is shared',
  rubric3: 'SECRET-RUBRIC-3 full marks',
  rubric0: 'SECRET-RUBRIC-0 nothing',
  trap: 'SECRET-TRAP adding probabilities',
  wgll: 'SECRET-WGLL concrete and numeric',
  key: 'A7',
};

/** A "question row" that carries every confidential field, to prove none of it can leak. */
const leakyRow = {
  key: SECRETS.key,
  prompt: 'What does this print?',
  dataset: { format: 'csv' as const, text: 'a,b\n1,2' },
  code: { language: 'python', text: 'print(1)' },
  timeMinutes: 2,
  title: SECRETS.title,
  modelAnswer: SECRETS.modelAnswer,
  rubric: { '3': SECRETS.rubric3, '2': 'x', '1': 'y', '0': SECRETS.rubric0 },
  trapOrBonus: SECRETS.trap,
  whatGoodLooksLike: SECRETS.wgll,
  score: 3,
  notes: 'SECRET-NOTES',
};

const base: CandidateStateInput = {
  orgName: 'G-20 Group',
  section: { candidateLabel: 'Written test — Part A', showInstructions: true },
  candidateInstructions: 'Show your working.',
  status: 'live',
  presentedQuestionKey: SECRETS.key,
  presentedAt: new Date('2026-09-27T12:00:00.000Z'),
  version: 4,
  sectionQuestions: [{ key: 'A1', prompt: 'first', dataset: null, code: null, timeMinutes: 1 }, leakyRow],
  now: new Date('2026-09-27T12:00:05.000Z'),
  recordingRequired: true,
  consentAt: new Date('2026-09-27T11:55:00.000Z'),
  retentionDays: 90,
  presentedAnswer: { candidateAnswer: 'my typed answer', candidateAnswerAt: new Date('2026-09-27T12:00:03.000Z') },
  sectionEndsAt: new Date('2026-09-27T12:12:00.000Z'),
};

const STATE_KEYS = [
  'phase', 'orgName', 'sectionLabel', 'instructions', 'question', 'presentedAt', 'serverNow', 'version',
  'recording', 'answer', 'sectionEndsAt',
].sort();
const QUESTION_KEYS = ['position', 'total', 'prompt', 'dataset', 'code', 'timeMinutes'].sort();
const RECORDING_KEYS = ['required', 'consentGiven', 'consentText'].sort();
const ANSWER_KEYS = ['text', 'savedAt'].sort();

describe('buildCandidateState', () => {
  it('returns exactly the CandidateState and CandidateQuestion keys', () => {
    const state = buildCandidateState(base);
    expect(Object.keys(state).sort()).toEqual(STATE_KEYS);
    expect(Object.keys(state.question!).sort()).toEqual(QUESTION_KEYS);
    expect(state.question).toEqual({
      position: 2,
      total: 2,
      prompt: 'What does this print?',
      dataset: { format: 'csv', text: 'a,b\n1,2' },
      code: { language: 'python', text: 'print(1)' },
      timeMinutes: 2,
    });
    expect(state.presentedAt).toBe('2026-09-27T12:00:00.000Z');
    expect(state.serverNow).toBe('2026-09-27T12:00:05.000Z');
    expect(state.version).toBe(4);
    expect(Object.keys(state.recording).sort()).toEqual(RECORDING_KEYS);
    expect(Object.keys(state.answer!).sort()).toEqual(ANSWER_KEYS);
    expect(state.answer).toEqual({ text: 'my typed answer', savedAt: '2026-09-27T12:00:03.000Z' });
    expect(state.sectionEndsAt).toBe('2026-09-27T12:12:00.000Z');
  });

  it('recording: consent text is versioned, names the org and the retention period', () => {
    const state = buildCandidateState(base);
    expect(state.recording.required).toBe(true);
    expect(state.recording.consentGiven).toBe(true);
    expect(state.recording.consentText).toContain('Only the G-20 Group hiring team');
    expect(state.recording.consentText).toContain('deleted 90 days after');
    expect(buildCandidateState({ ...base, consentAt: null, retentionDays: 30 }).recording).toMatchObject({
      consentGiven: false,
      consentText: expect.stringContaining('deleted 30 days after'),
    });
    expect(buildCandidateState({ ...base, recordingRequired: false }).recording).toEqual({
      required: false,
      consentGiven: true,
      consentText: null,
    });
  });

  it('answer: empty when nothing typed, null outside the question phase; sectionEndsAt null when untimed', () => {
    expect(buildCandidateState({ ...base, presentedAnswer: null }).answer).toEqual({ text: '', savedAt: null });
    expect(buildCandidateState({ ...base, presentedAnswer: { candidateAnswer: null, candidateAnswerAt: null } }).answer).toEqual({
      text: '',
      savedAt: null,
    });
    expect(buildCandidateState({ ...base, status: 'ready', presentedQuestionKey: null }).answer).toBeNull();
    expect(buildCandidateState({ ...base, status: 'live', presentedQuestionKey: null }).answer).toBeNull();
    expect(buildCandidateState({ ...base, status: 'completed', presentedQuestionKey: null }).answer).toBeNull();
    expect(buildCandidateState({ ...base, sectionEndsAt: null }).sectionEndsAt).toBeNull();
  });

  it('never leaks confidential question fields', () => {
    const json = JSON.stringify(buildCandidateState(base));
    for (const secret of Object.values(SECRETS)) expect(json).not.toContain(secret);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('first'); // other questions are not included either
  });

  it('maps status to phase and shows instructions only on intro', () => {
    expect(buildCandidateState({ ...base, status: 'ready', presentedQuestionKey: null })).toMatchObject({
      phase: 'waiting',
      instructions: null,
      question: null,
      presentedAt: null,
    });
    expect(buildCandidateState({ ...base, status: 'live', presentedQuestionKey: null, presentedAt: null })).toMatchObject({
      phase: 'intro',
      instructions: 'Show your working.',
      question: null,
    });
    expect(
      buildCandidateState({
        ...base,
        status: 'live',
        presentedQuestionKey: null,
        section: { ...base.section, showInstructions: false },
      }),
    ).toMatchObject({ phase: 'intro', instructions: null });
    expect(buildCandidateState({ ...base, status: 'completed', presentedQuestionKey: null })).toMatchObject({
      phase: 'ended',
      question: null,
      instructions: null,
    });
  });
});
