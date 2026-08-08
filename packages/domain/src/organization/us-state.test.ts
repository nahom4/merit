import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { UsState } from './us-state.js';

describe('UsState', () => {
  it('accepts a two-letter state code', () => {
    const result = UsState.parse('NC');
    expect(isOk(result) && UsState.toString(result.value)).toBe('NC');
  });

  it('uppercases a lowercase code, because filings are inconsistent about case', () => {
    const result = UsState.parse('nc');
    expect(isOk(result) && UsState.toString(result.value)).toBe('NC');
  });

  it('trims surrounding whitespace left by fixed-width source fields', () => {
    const result = UsState.parse('  OH ');
    expect(isOk(result) && UsState.toString(result.value)).toBe('OH');
  });

  it('accepts the District of Columbia', () => {
    expect(isOk(UsState.parse('DC'))).toBe(true);
  });

  it('accepts Puerto Rico, which files with the IRS like any state', () => {
    expect(isOk(UsState.parse('PR'))).toBe(true);
  });

  it('rejects a code that is not a real jurisdiction', () => {
    expect(isErr(UsState.parse('XX'))).toBe(true);
  });

  it('rejects a full state name', () => {
    expect(isErr(UsState.parse('North Carolina'))).toBe(true);
  });

  it('rejects a non-string', () => {
    expect(isErr(UsState.parse(37))).toBe(true);
  });

  it('reports the neighbouring states that make up a funding region', () => {
    const nc = UsState.parse('NC');
    expect(isOk(nc) && [...UsState.region(nc.value)].sort()).toEqual(['GA', 'NC', 'SC', 'TN', 'VA']);
  });

  it('includes the state itself in its own region', () => {
    const oh = UsState.parse('OH');
    expect(isOk(oh) && UsState.region(oh.value).has('OH')).toBe(true);
  });

  it('falls back to the state alone for a jurisdiction with no land border', () => {
    const hi = UsState.parse('HI');
    expect(isOk(hi) && [...UsState.region(hi.value)]).toEqual(['HI']);
  });
});
