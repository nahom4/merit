import { describe, expect, it } from 'vitest';
import { Organization } from '@merit/domain';
import { unwrapOrThrow } from '@merit/shared';
import { toOrganizationProfileView } from './view-model.js';

const capeFear = unwrapOrThrow(
  Organization.parse({
    id: 'org_capefear',
    name: 'Cape Fear Literacy Council',
    ein: '581613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 655_738,
  }),
);

describe('toOrganizationProfileView', () => {
  it('keeps the organisation name as filed', () => {
    expect(toOrganizationProfileView(capeFear).name).toBe('Cape Fear Literacy Council');
  });

  it('formats the EIN the way the IRS prints it', () => {
    expect(toOrganizationProfileView(capeFear).ein).toBe('58-1613254');
  });

  it('renders the location as city and state', () => {
    expect(toOrganizationProfileView(capeFear).location).toBe('Wilmington, NC');
  });

  it('names the program area rather than showing a bare code', () => {
    expect(toOrganizationProfileView(capeFear).programArea).toBe('Education (B60)');
  });

  it('formats revenue as whole dollars with separators', () => {
    expect(toOrganizationProfileView(capeFear).annualRevenue).toBe('$655,738');
  });

  it('states the materiality floor, because it is why small grants are excluded', () => {
    // 0.5% of $655,738 is $3,278.69, above the $2,500 minimum. RESULTS.txt reports $3,279.
    expect(toOrganizationProfileView(capeFear).materialityFloor).toBe('$3,279');
  });

  it('applies the $2,500 minimum floor for an organisation too small for the percentage', () => {
    const tiny = unwrapOrThrow(Organization.parse({ ...capeFear, annualRevenueDollars: 100_000 }));
    expect(toOrganizationProfileView(tiny).materialityFloor).toBe('$2,500');
  });

  it('lists the funding region so the user can see which states count as local', () => {
    expect(toOrganizationProfileView(capeFear).region).toBe('NC, GA, SC, TN, VA');
  });
});
