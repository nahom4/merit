import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { Organization } from './organization.js';

const capeFear = {
  id: 'org_capefear',
  name: 'Cape Fear Literacy Council',
  ein: '58-1613254',
  city: 'Wilmington',
  state: 'NC',
  nteeCode: 'B60',
  annualRevenueDollars: 655_738,
};

describe('Organization.parse', () => {
  it('parses a complete profile', () => {
    const result = Organization.parse(capeFear);
    expect(isOk(result) && result.value.name).toBe('Cape Fear Literacy Council');
  });

  it('normalises the EIN it was given', () => {
    const result = Organization.parse(capeFear);
    expect(isOk(result) && result.value.ein).toBe('581613254');
  });

  it('stores revenue as integer cents', () => {
    const result = Organization.parse(capeFear);
    expect(isOk(result) && result.value.annualRevenue).toBe(65_573_800);
  });

  it('trims a name padded by a form field', () => {
    const result = Organization.parse({ ...capeFear, name: '  Cape Fear Literacy Council  ' });
    expect(isOk(result) && result.value.name).toBe('Cape Fear Literacy Council');
  });

  it('rejects a profile with no name, naming the offending field', () => {
    const result = Organization.parse({ ...capeFear, name: '   ' });
    expect(isErr(result) && result.error.context['field']).toBe('name');
  });

  it('rejects a profile with no id', () => {
    const result = Organization.parse({ ...capeFear, id: '' });
    expect(isErr(result) && result.error.context['field']).toBe('id');
  });

  it('rejects a profile with no city', () => {
    const result = Organization.parse({ ...capeFear, city: '' });
    expect(isErr(result) && result.error.context['field']).toBe('city');
  });

  it('rejects an unusable state code', () => {
    const result = Organization.parse({ ...capeFear, state: 'ZZ' });
    expect(isErr(result) && result.error.context['field']).toBe('state');
  });

  it('rejects an unusable EIN', () => {
    const result = Organization.parse({ ...capeFear, ein: 'not-an-ein' });
    expect(isErr(result) && result.error.context['field']).toBe('ein');
  });

  it('rejects an unusable program code', () => {
    const result = Organization.parse({ ...capeFear, nteeCode: '99' });
    expect(isErr(result) && result.error.context['field']).toBe('nteeCode');
  });

  it('rejects negative revenue', () => {
    const result = Organization.parse({ ...capeFear, annualRevenueDollars: -1 });
    expect(isErr(result) && result.error.context['field']).toBe('amount');
  });

  it('rejects a non-object', () => {
    expect(isErr(Organization.parse('Cape Fear Literacy Council'))).toBe(true);
  });

  it('rejects null', () => {
    expect(isErr(Organization.parse(null))).toBe(true);
  });
});

describe('Organization region', () => {
  it('reports the funding region as the state plus its neighbours', () => {
    const result = Organization.parse(capeFear);
    expect(isOk(result) && [...Organization.region(result.value)].sort()).toEqual([
      'GA',
      'NC',
      'SC',
      'TN',
      'VA',
    ]);
  });
});
