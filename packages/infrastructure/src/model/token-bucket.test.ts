import { describe, expect, it } from 'vitest';
import { TokenBucket } from './token-bucket.js';

/** A clock a test drives by hand. No `setTimeout` on a real clock in a unit test. */
const testClock = (startIso: string) => {
  let current = new Date(startIso).getTime();
  return {
    clock: { now: () => new Date(current) },
    advance: (ms: number) => {
      current += ms;
    },
  };
};

const bucket = (perMinute: number, perDay: number, startIso = '2026-08-08T06:00:00.000Z') => {
  const { clock, advance } = testClock(startIso);
  return { bucket: new TokenBucket({ perMinute, perDay, clock }), advance };
};

describe('TokenBucket', () => {
  it('hands out a token when the minute has room', () => {
    const { bucket: tokens } = bucket(15, 1_500);

    expect(tokens.take().kind).toBe('granted');
  });

  it('makes the sixteenth call in a minute wait rather than exceeding the rate', () => {
    const { bucket: tokens } = bucket(15, 1_500);
    for (let call = 0; call < 15; call += 1) expect(tokens.take().kind).toBe('granted');

    const sixteenth = tokens.take();

    expect(sixteenth.kind).toBe('wait');
    expect(sixteenth.kind === 'wait' ? sixteenth.waitMs : 0).toBeGreaterThan(0);
  });

  it('refills over the minute rather than all at once', () => {
    const { bucket: tokens, advance } = bucket(15, 1_500);
    for (let call = 0; call < 15; call += 1) tokens.take();

    // One fifteenth of a minute is one token's worth.
    advance(4_000);

    expect(tokens.take().kind).toBe('granted');
    expect(tokens.take().kind).toBe('wait');
  });

  it('never lends more than a minute’s worth however long it has been idle', () => {
    const { bucket: tokens, advance } = bucket(15, 1_500);
    advance(60 * 60 * 1000);

    for (let call = 0; call < 15; call += 1) expect(tokens.take().kind).toBe('granted');

    expect(tokens.take().kind).toBe('wait');
  });

  it('is exhausted, not merely slow, when the day’s budget is spent', () => {
    const { bucket: tokens, advance } = bucket(15, 20);

    for (let call = 0; call < 20; call += 1) {
      if (tokens.take().kind !== 'granted') advance(60_000);
      else continue;
      tokens.take();
    }

    // The distinction matters: waiting is degradation, exhaustion is a different answer --
    // serve what is persisted and queue the rest.
    const next = tokens.take();
    expect(next.kind).toBe('exhausted');
  });

  it('starts a new day with a full daily budget', () => {
    const { bucket: tokens, advance } = bucket(15, 3);
    tokens.take();
    tokens.take();
    tokens.take();
    expect(tokens.take().kind).toBe('exhausted');

    advance(24 * 60 * 60 * 1000);

    expect(tokens.take().kind).toBe('granted');
  });

  it('reports what is left, so the run log can state it', () => {
    const { bucket: tokens } = bucket(15, 1_500);
    tokens.take();

    expect(tokens.remainingToday()).toBe(1_499);
  });
});
