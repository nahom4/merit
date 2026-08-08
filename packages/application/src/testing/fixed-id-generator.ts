import type { IdGenerator } from '../ports/id-generator.port.js';
import type { Clock } from '../ports/clock.port.js';

/** Hands out the given ids in order, then repeats the last one. */
export const fixedIdGenerator = (...ids: readonly string[]): IdGenerator => {
  let index = 0;
  return {
    next: () => ids[Math.min(index++, ids.length - 1)] ?? 'id_0',
  };
};

/** A clock stopped at a known instant, so assertions on timestamps are stable. */
export const fixedClock = (isoInstant: string): Clock => ({
  now: () => new Date(isoInstant),
});
