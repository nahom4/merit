import type { Clock } from '@merit/application';

/**
 * The rate limit, modelled rather than discovered.
 *
 * Gemini's free tier allows 15 requests a minute and 1,500 a day. Retrying on HTTP 429 is the
 * alternative and it is worse: you learn you were over the limit by being punished for it, and
 * under concurrency the whole budget goes on retries.
 *
 * Two buckets, because the two limits mean different things. Running out of the per-minute
 * bucket is a wait -- the work will happen shortly. Running out of the daily bucket is
 * exhaustion: nothing more will happen today, so the caller must serve what is persisted and
 * queue the rest rather than blocking until midnight.
 *
 * The clock is injected. Time is a port here for the same reason it is everywhere else, and it
 * is what makes this testable without waiting real seconds.
 */
export type TokenGrant =
  | { readonly kind: 'granted' }
  | { readonly kind: 'wait'; readonly waitMs: number }
  | { readonly kind: 'exhausted'; readonly resetsAt: string };

export interface TokenBucketOptions {
  readonly perMinute: number;
  readonly perDay: number;
  readonly clock: Clock;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class TokenBucket {
  private available: number;
  private lastRefillMs: number;
  private spentToday = 0;
  private dayStartedMs: number;

  constructor(private readonly options: TokenBucketOptions) {
    this.available = options.perMinute;
    this.lastRefillMs = options.clock.now().getTime();
    this.dayStartedMs = this.lastRefillMs;
  }

  remainingToday(): number {
    return Math.max(0, this.options.perDay - this.spentToday);
  }

  take(): TokenGrant {
    const nowMs = this.options.clock.now().getTime();

    if (nowMs - this.dayStartedMs >= DAY_MS) {
      this.dayStartedMs = nowMs;
      this.spentToday = 0;
    }

    if (this.spentToday >= this.options.perDay) {
      return { kind: 'exhausted', resetsAt: new Date(this.dayStartedMs + DAY_MS).toISOString() };
    }

    // Continuous refill, capped at one minute's worth: an hour of idleness does not buy a
    // burst of 900 calls, which is what a naive "reset every minute" would allow.
    const elapsed = nowMs - this.lastRefillMs;
    if (elapsed > 0) {
      this.available = Math.min(
        this.options.perMinute,
        this.available + (elapsed * this.options.perMinute) / MINUTE_MS,
      );
      this.lastRefillMs = nowMs;
    }

    if (this.available < 1) {
      const shortfall = 1 - this.available;
      return { kind: 'wait', waitMs: Math.ceil((shortfall * MINUTE_MS) / this.options.perMinute) };
    }

    this.available -= 1;
    this.spentToday += 1;
    return { kind: 'granted' };
  }
}
