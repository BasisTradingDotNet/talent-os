import { computeVerdict, elapsedSeconds, VerdictQuestion, VerdictResponse, autoScoreFor, computeAutoVerdict } from './verdict';

const tenQuestions: VerdictQuestion[] = Array.from({ length: 10 }, (_, i) => ({
  key: `A${i + 1}`,
  domain: i < 5 ? 'quant' : 'python',
}));

const setA = {
  maxScore: 30,
  bands: [{ min: 24, label: 'Pass — progress' }],
  domainGroups: [
    { domain: 'quant' as const, label: 'Quant' },
    { domain: 'python' as const, label: 'Python' },
  ],
};

const resp = (key: string, score: number | null, skipped = false): VerdictResponse => ({
  questionKey: key,
  score,
  skipped,
});

describe('computeVerdict', () => {
  it('reports an incomplete section with running totals', () => {
    const v = computeVerdict(setA, tenQuestions, [resp('A1', 3), resp('A2', 2), resp('A6', 1)]);
    expect(v.total).toBe(6);
    expect(v.max).toBe(30);
    expect(v.scored).toBe(3);
    expect(v.skipped).toBe(0);
    expect(v.complete).toBe(false);
    expect(v.subtotals).toEqual([
      { domain: 'quant', label: 'Quant', total: 5, max: 15 },
      { domain: 'python', label: 'Python', total: 1, max: 15 },
    ]);
    expect(v.band).toBeNull();
    expect(v.result).toBe('Below threshold');
  });

  it('is complete once every question is scored or skipped and applies the band', () => {
    const scores = [3, 3, 2, 3, 3, 2, 3, 3, 2, 3]; // 27
    const v = computeVerdict(
      setA,
      tenQuestions,
      tenQuestions.map((q, i) => resp(q.key, scores[i])),
    );
    expect(v.total).toBe(27);
    expect(v.complete).toBe(true);
    expect(v.scored).toBe(10);
    expect(v.band).toEqual({ min: 24, label: 'Pass — progress' });
    expect(v.result).toBe('Pass — progress');
    expect(v.subtotals[0]).toEqual({ domain: 'quant', label: 'Quant', total: 14, max: 15 });
    expect(v.subtotals[1]).toEqual({ domain: 'python', label: 'Python', total: 13, max: 15 });
  });

  it('counts skipped questions towards completeness but not the total', () => {
    const responses = tenQuestions.slice(0, 9).map((q) => resp(q.key, 3));
    responses.push(resp('A10', null, true));
    const v = computeVerdict(setA, tenQuestions, responses);
    expect(v.total).toBe(27);
    expect(v.scored).toBe(9);
    expect(v.skipped).toBe(1);
    expect(v.complete).toBe(true);
  });

  it('picks the highest band reached for a two-band section', () => {
    const setC = { maxScore: null, bands: [{ min: 20, label: 'Exceptional' }, { min: 15, label: 'Strong hire signal' }], domainGroups: [] };
    const scoreAll = (total: number) => {
      const per = tenQuestions.map(() => 0);
      let left = total;
      for (let i = 0; i < per.length && left > 0; i++) {
        per[i] = Math.min(3, left);
        left -= per[i];
      }
      return tenQuestions.map((q, i) => resp(q.key, per[i]));
    };
    expect(computeVerdict(setC, tenQuestions, scoreAll(21))).toMatchObject({ max: 30, result: 'Exceptional', band: { min: 20 } });
    expect(computeVerdict(setC, tenQuestions, scoreAll(17))).toMatchObject({ result: 'Strong hire signal', band: { min: 15 } });
    expect(computeVerdict(setC, tenQuestions, scoreAll(10))).toMatchObject({ result: 'Below threshold', band: null });
  });

  it('ignores responses for keys outside the section', () => {
    const v = computeVerdict(setA, tenQuestions, [resp('B1', 3)]);
    expect(v.total).toBe(0);
    expect(v.scored).toBe(0);
  });
});

describe('elapsedSeconds', () => {
  it('floors to whole seconds and never goes negative', () => {
    const t0 = new Date('2026-09-27T12:00:00.000Z');
    expect(elapsedSeconds(t0, new Date('2026-09-27T12:00:04.999Z'))).toBe(4);
    expect(elapsedSeconds(t0, new Date('2026-09-27T12:03:30.000Z'))).toBe(210);
    expect(elapsedSeconds(t0, new Date('2026-09-27T11:59:59.000Z'))).toBe(0);
  });
});

describe('computeAutoVerdict (v1.2)', () => {
  const section = {
    maxScore: null,
    bands: [{ min: 2.5, label: 'Pass' }, { min: 4, label: 'Strong' }],
    domainGroups: [{ domain: 'math' as const, label: 'Maths' }, { domain: 'probability' as const, label: 'Probability' }],
    autoScoring: { correct: 1, wrong: -0.25, blank: 0 },
  };
  const questions = [
    { key: 'M1', domain: 'math' },
    { key: 'M2', domain: 'math' },
    { key: 'M3', domain: 'math' },
    { key: 'M4', domain: 'probability' },
    { key: 'M5', domain: 'probability' },
  ];

  it('3 right, 1 wrong, 1 blank → 2.75 with per-domain subtotals; complete only when submitted or all answered', () => {
    const responses = [
      { questionKey: 'M1', choice: 0, autoScore: 1 },
      { questionKey: 'M2', choice: 1, autoScore: 1 },
      { questionKey: 'M3', choice: 2, autoScore: 1 },
      { questionKey: 'M4', choice: 3, autoScore: -0.25 },
      { questionKey: 'M5', choice: null, autoScore: null },
      { questionKey: 'ZZ', choice: 0, autoScore: 1 }, // not in the section: ignored
    ];
    const v = computeAutoVerdict(section, questions, responses, false);
    expect(v).toMatchObject({ total: 2.75, max: 5, scored: 4, skipped: 1, complete: false, result: 'Pass', band: { min: 2.5, label: 'Pass' } });
    expect(v.subtotals).toEqual([
      { domain: 'math', label: 'Maths', total: 3, max: 3 },
      { domain: 'probability', label: 'Probability', total: -0.25, max: 2 },
    ]);
    expect(computeAutoVerdict(section, questions, responses, true).complete).toBe(true);
    expect(computeAutoVerdict(section, questions, [], false)).toMatchObject({ total: 0, scored: 0, skipped: 5, complete: false, result: 'Below threshold' });
    const all = responses.slice(0, 4).concat([{ questionKey: 'M5', choice: 0, autoScore: 1 }]);
    expect(computeAutoVerdict(section, questions, all, false)).toMatchObject({ total: 3.75, complete: true, result: 'Pass' });
  });

  it('blanks count autoScoring.blank; autoScoreFor applies the marking scheme', () => {
    const negBlank = { ...section, autoScoring: { correct: 2, wrong: -1, blank: -0.5 } };
    expect(computeAutoVerdict(negBlank, questions, [{ questionKey: 'M1', choice: 0, autoScore: 2 }], false)).toMatchObject({ total: 0, max: 10 });
    expect(autoScoreFor(negBlank.autoScoring, null, 1)).toBe(-0.5);
    expect(autoScoreFor(negBlank.autoScoring, 1, 1)).toBe(2);
    expect(autoScoreFor(negBlank.autoScoring, 0, 1)).toBe(-1);
  });
});
