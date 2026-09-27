import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { cfg } from '../common/config';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Simple in-memory token bucket keyed by an opaque string (the candidate token). */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastPrune = 0;

  constructor(private readonly burst: number, private readonly perSecond: number) {}

  /** True when the request may proceed. */
  take(key: string, now = Date.now()): boolean {
    this.prune(now);
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, updatedAt: now };
      this.buckets.set(key, b);
    } else {
      const refill = ((now - b.updatedAt) / 1000) * this.perSecond;
      b.tokens = Math.min(this.burst, b.tokens + refill);
      b.updatedAt = now;
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Drop buckets idle for over a minute (they would be full again anyway). */
  private prune(now: number): void {
    if (now - this.lastPrune < 30_000 && this.buckets.size < 10_000) return;
    this.lastPrune = now;
    for (const [k, b] of this.buckets) if (now - b.updatedAt > 60_000) this.buckets.delete(k);
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Per-token rate limit for /api/candidate/:token/*. 429 with Retry-After when exhausted. */
@Injectable()
export class CandidateRateLimitGuard implements CanActivate {
  private limiter: TokenBucketLimiter | null = null;

  private get limits(): TokenBucketLimiter {
    if (!this.limiter) {
      const { candidateRateBurst, candidateRatePerSecond } = cfg();
      this.limiter = new TokenBucketLimiter(candidateRateBurst, candidateRatePerSecond);
    }
    return this.limiter;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = String(req.params?.token ?? req.ip ?? 'anon');
    if (this.limits.take(key)) return true;
    ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', '1');
    throw new HttpException('too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}
