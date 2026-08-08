import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { NteeCode } from './ntee-code.js';

describe('NteeCode', () => {
  it('accepts a major group letter with two digits', () => {
    const result = NteeCode.parse('B60');
    expect(isOk(result) && NteeCode.toString(result.value)).toBe('B60');
  });

  it('accepts the trailing letter the BMF appends to some codes', () => {
    const result = NteeCode.parse('B60Z');
    expect(isOk(result) && NteeCode.toString(result.value)).toBe('B60Z');
  });

  it('uppercases and trims, because the BMF is a fixed-width CSV', () => {
    const result = NteeCode.parse(' e32 ');
    expect(isOk(result) && NteeCode.toString(result.value)).toBe('E32');
  });

  it('accepts a bare major group letter, which some registry rows carry', () => {
    const result = NteeCode.parse('P');
    expect(isOk(result) && NteeCode.toString(result.value)).toBe('P');
  });

  it('accepts the four-character deciles form the BMF actually publishes', () => {
    // 147,935 registry rows carry codes like this. Rejecting them excluded a tenth of the
    // registry from ever being profiled or counted as a peer.
    const result = NteeCode.parse('A116');
    expect(isOk(result) && NteeCode.toString(result.value)).toBe('A116');
  });

  it('accepts a code with a letter inside it, which the deciles form also produces', () => {
    const result = NteeCode.parse('A6E0');
    expect(isOk(result) && NteeCode.majorGroup(result.value)).toBe('A');
  });

  it('accepts the two-character form a few hundred registry rows carry', () => {
    expect(isOk(NteeCode.parse('A1'))).toBe(true);
  });

  it('rejects a code longer than the BMF field can hold', () => {
    expect(isErr(NteeCode.parse('B60ZZ'))).toBe(true);
  });

  it('rejects a code whose major group is not a letter', () => {
    expect(isErr(NteeCode.parse('160'))).toBe(true);
  });

  it('rejects an empty string rather than inventing an unknown group', () => {
    expect(isErr(NteeCode.parse(''))).toBe(true);
  });

  it('rejects a non-string', () => {
    expect(isErr(NteeCode.parse(60))).toBe(true);
  });

  it('reports the major group, which is what peer matching blocks on', () => {
    const result = NteeCode.parse('B60');
    expect(isOk(result) && NteeCode.majorGroup(result.value)).toBe('B');
  });

  it('names the major group in the words a development director uses', () => {
    const result = NteeCode.parse('B60');
    expect(isOk(result) && NteeCode.majorGroupLabel(result.value)).toBe('Education');
  });

  it('treats two codes in the same major group as the same program area', () => {
    const literacy = NteeCode.parse('B60');
    const adultEd = NteeCode.parse('B92');
    expect(isOk(literacy) && isOk(adultEd) && NteeCode.sharesMajorGroup(literacy.value, adultEd.value)).toBe(
      true,
    );
  });

  it('treats codes in different major groups as different program areas', () => {
    const literacy = NteeCode.parse('B60');
    const clinic = NteeCode.parse('E32');
    expect(isOk(literacy) && isOk(clinic) && NteeCode.sharesMajorGroup(literacy.value, clinic.value)).toBe(
      false,
    );
  });
});
