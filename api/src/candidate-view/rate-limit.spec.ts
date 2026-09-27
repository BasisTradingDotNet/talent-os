import { TokenBucketLimiter } from './rate-limit';

describe('TokenBucketLimiter', () => {
  it('allows a burst, then refills at the configured rate, per key', () => {
    const l = new TokenBucketLimiter(3, 2);
    const t0 = 1_000_000;
    expect([l.take('a', t0), l.take('a', t0), l.take('a', t0)]).toEqual([true, true, true]);
    expect(l.take('a', t0)).toBe(false); // burst exhausted
    expect(l.take('b', t0)).toBe(true); // other tokens are independent
    expect(l.take('a', t0 + 499)).toBe(false); // < 1 token refilled
    expect(l.take('a', t0 + 500)).toBe(true); // 1 token refilled at 2/s
    expect(l.take('a', t0 + 500)).toBe(false);
    expect(l.take('a', t0 + 10_000)).toBe(true); // refill is capped at the burst
    expect(l.take('a', t0 + 10_000)).toBe(true);
    expect(l.take('a', t0 + 10_000)).toBe(true);
    expect(l.take('a', t0 + 10_000)).toBe(false);
  });

  it('forgets idle buckets', () => {
    const l = new TokenBucketLimiter(1, 1);
    l.take('a', 0);
    expect(l.size).toBe(1);
    l.take('b', 120_000); // > 60 s idle → pruned
    expect(l.size).toBe(1);
  });
});
