/**
 * Time is injected. `Date.now()` outside this port makes a test depend on wall time,
 * and untestable code is not shippable code (docs/conventions.md).
 */
export interface Clock {
  now(): Date;
}
