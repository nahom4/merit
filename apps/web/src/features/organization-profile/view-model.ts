import { Cents, Ein, NteeCode, Organization, UsState } from '@merit/domain';
import { materialityFloor } from '@merit/domain';

/**
 * What the profile screen needs, and nothing else. Formatting lives here rather than in JSX
 * so it can be unit-tested and so no component ever calls `toLocaleString` inline.
 */
export interface OrganizationProfileView {
  readonly id: string;
  readonly name: string;
  readonly ein: string;
  readonly location: string;
  readonly programArea: string;
  readonly annualRevenue: string;
  readonly materialityFloor: string;
  readonly region: string;
}

const wholeDollars = (cents: Cents): string =>
  `$${Math.round(Cents.toDollars(cents)).toLocaleString('en-US')}`;

export const toOrganizationProfileView = (organization: Organization): OrganizationProfileView => {
  const code = NteeCode.toString(organization.nteeCode);
  const state = UsState.toString(organization.state);
  const ein = Ein.toString(organization.ein);

  return {
    id: organization.id as string,
    name: organization.name,
    ein: `${ein.slice(0, 2)}-${ein.slice(2)}`,
    location: `${organization.city}, ${state}`,
    programArea: `${NteeCode.majorGroupLabel(organization.nteeCode)} (${code})`,
    annualRevenue: wholeDollars(organization.annualRevenue),
    materialityFloor: wholeDollars(materialityFloor(organization.annualRevenue)),
    // The organisation's own state first, then its neighbours alphabetically -- the reader
    // is checking "is my state in here", not scanning an alphabetised list.
    region: [state, ...[...Organization.region(organization)].filter((s) => s !== state).sort()].join(', '),
  };
};
