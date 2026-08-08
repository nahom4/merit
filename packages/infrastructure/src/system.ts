import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '@merit/application';

/** The only place `Date.now()` is allowed to live. */
export const systemClock: Clock = { now: () => new Date() };

/** The only place randomness is allowed to live. */
export const uuidIdGenerator = (prefix: string): IdGenerator => ({
  next: () => `${prefix}_${randomUUID()}`,
});
