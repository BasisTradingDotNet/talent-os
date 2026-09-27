import { computeVerdict, elapsedSeconds, VerdictQuestion, VerdictResponse } from './verdict';

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
