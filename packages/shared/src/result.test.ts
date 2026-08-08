import { describe, expect, it } from 'vitest';
import { andThen, collect, err, isErr, isOk, map, mapErr, ok, unwrapOr } from './result.js';

describe('Result', () => {
  it('carries a value on success', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(isOk(result) && result.value).toBe(42);
  });

  it('carries an error on failure', () => {
    const result = err('nope');
    expect(result.ok).toBe(false);
    expect(isErr(result) && result.error).toBe('nope');
  });

  it('maps the value of a success', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
  });

  it('leaves a failure untouched when mapping the value', () => {
    expect(map(err<string>('boom'), (n: number) => n * 3)).toEqual(err('boom'));
  });

  it('maps the error of a failure', () => {
    expect(mapErr(err('boom'), (e) => e.toUpperCase())).toEqual(err('BOOM'));
  });

  it('leaves a success untouched when mapping the error', () => {
    expect(mapErr(ok(1), (e: string) => e.toUpperCase())).toEqual(ok(1));
  });

  it('chains a fallible step onto a success', () => {
    expect(andThen(ok(4), (n) => ok(n + 1))).toEqual(ok(5));
  });

  it('short-circuits the chain on the first failure', () => {
    expect(andThen(err<string>('first'), () => ok(1))).toEqual(err('first'));
  });

  it('returns the fallback for a failure', () => {
    expect(unwrapOr(err('boom'), 7)).toBe(7);
  });

  it('returns the value for a success rather than the fallback', () => {
    expect(unwrapOr(ok(1), 7)).toBe(1);
  });

  it('collects a list of successes into a success of a list', () => {
    expect(collect([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
  });

  it('collects to the first failure rather than reporting all of them', () => {
    expect(collect([ok(1), err('second'), err('third')])).toEqual(err('second'));
  });
});
