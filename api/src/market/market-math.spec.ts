import { computeMetrics, diceFairValue, maxAbsPosition, parseMarketConfig, pnlOf, positionOf, QuoteLike, TradeLike } from './market-math';

const q = (id: string, bid: number, ask: number, revealsSoFar = 0): QuoteLike => ({ id, bid, ask, size: 10, revealsSoFar });
const t = (side: 'buy' | 'sell', price: number, size: number, quoteId: string | null = null): TradeLike => ({ side, price, size, quoteId });

describe('dice fair value', () => {
  it('is Σ revealed + remaining × (sides + 1) / 2', () => {
    expect(diceFairValue([3, 5], 0, 2, 6)).toBe(7);
    expect(diceFairValue([3, 5], 1, 2, 6)).toBe(6.5);
    expect(diceFairValue([3, 5], 2, 2, 6)).toBe(8);
    expect(diceFairValue([1, 1, 1], 0, 3, 20)).toBe(31.5);
  });

  it('never reads beyond the rolls', () => {
    expect(diceFairValue([4], 5, 1, 6)).toBe(4);
  });
});

describe('P&L and position (candidate side)', () => {
  it('candidate sold at 12 (interviewer bought), settles 10 → +2', () => {
    expect(pnlOf([t('buy', 12, 1)], 10)).toBe(2);
  });

  it('candidate bought at 9 (interviewer sold), settles 10 → +1 per unit', () => {
    expect(pnlOf([t('sell', 9, 2)], 10)).toBe(2);
  });

  it('losses are negative', () => {
    expect(pnlOf([t('buy', 8, 3)], 10)).toBe(-6);
    expect(pnlOf([t('sell', 12, 1)], 10)).toBe(-2);
  });

  it('position: interviewer buy → −size, sell → +size; max |position| tracks the path', () => {
    const trades = [t('buy', 12, 4), t('buy', 12, 3), t('sell', 9, 10)];
    expect(positionOf(trades)).toBe(3);
    expect(maxAbsPosition(trades)).toBe(7);
    expect(positionOf([])).toBe(0);
    expect(maxAbsPosition([])).toBe(0);
  });
});

describe('metrics', () => {
  const quotes = [q('q1', 9, 12), q('q2', 10, 13), q('q3', 8, 11)];

  it('spread, fair-value discipline and skew after trades', () => {
    const trades = [t('buy', 12, 1, 'q1'), t('sell', 10, 2, 'q2'), t('buy', 11, 1, 'q3')];
    const m = computeMetrics(quotes, trades, 10, () => 10);
    expect(m.quotes).toBe(3);
    expect(m.avgSpread).toBe(3);
    expect(m.fairInsideRate).toBe(1);
    expect(m.meanMidError).toBeCloseTo(2.5 / 3, 6);
    // buy on q1 → q2 mid up (skewed); sell on q2 → q3 mid down (skewed); buy on q3 → no next quote.
    expect(m.skewAfterTradeRate).toBe(1);
    expect(m.pnl).toBe((12 - 10) * 1 + (10 - 10) * 2 + (11 - 10) * 1);
    expect(m.maxAbsPosition).toBe(1);
  });

  it('counts a quote that did not move away from the hit side as not skewed', () => {
    const trades = [t('buy', 12, 1, 'q1'), t('sell', 10, 1, 'q2')];
    const m = computeMetrics([q('q1', 9, 12), q('q2', 9, 12), q('q3', 10, 13)], trades, 10, null);
    expect(m.skewAfterTradeRate).toBe(0);
    expect(m.fairInsideRate).toBeNull();
    expect(m.meanMidError).toBeNull();
  });

  it('fair value is evaluated at the reveal count of each quote', () => {
    const rolls = [6, 1];
    const fairAt = (r: number) => diceFairValue(rolls, r, 2, 6);
    const m = computeMetrics([q('a', 6, 8, 0), q('b', 9, 10, 1)], [], 7, fairAt);
    expect(m.fairInsideRate).toBe(1); // fair 7 inside [6, 8]; fair 9.5 inside [9, 10]
    expect(m.meanMidError).toBe(0);
  });

  it('empty games have zero spread and null ratios', () => {
    const m = computeMetrics([], [], 7, () => 7);
    expect(m).toEqual({ quotes: 0, avgSpread: 0, fairInsideRate: null, meanMidError: null, skewAfterTradeRate: null, pnl: 0, maxAbsPosition: 0 });
  });
});

describe('parseMarketConfig', () => {
  it('accepts dice and estimate templates', () => {
    expect(parseMarketConfig({ kind: 'dice', dice: 2, sides: 6 })).toEqual({ kind: 'dice', dice: 2, sides: 6 });
    expect(parseMarketConfig({ kind: 'estimate', trueValue: 384400, unit: 'km', hints: ['a', 1, 'b'] })).toEqual({
      kind: 'estimate',
      trueValue: 384400,
      unit: 'km',
      hints: ['a', 'b'],
    });
  });

  it('rejects anything else', () => {
    expect(parseMarketConfig(null)).toBeNull();
    expect(parseMarketConfig('dice')).toBeNull();
    expect(parseMarketConfig({ kind: 'dice', dice: 0, sides: 6 })).toBeNull();
    expect(parseMarketConfig({ kind: 'dice', dice: 2, sides: 1 })).toBeNull();
    expect(parseMarketConfig({ kind: 'estimate', trueValue: Infinity, unit: 'm', hints: [] })).toBeNull();
    expect(parseMarketConfig({ kind: 'coin' })).toBeNull();
  });
});
