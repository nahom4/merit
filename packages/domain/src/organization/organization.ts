import { andThen, err, map, ok, ParseError, type Brand, type Result } from '@merit/shared';
import { Ein } from '../shared/ein.js';
import { Cents } from '../shared/money.js';
import { NteeCode } from './ntee-code.js';
import { UsState } from './us-state.js';

export type OrganizationId = Brand<string, 'OrganizationId'>;

/**
 * The nonprofit Merit is working on behalf of. Every field here is an input to prospect
 * scoring: program code and revenue build the peer set, state builds the region, and revenue
 * sets the materiality floor below which a grant is not worth an application.
 */
export interface Organization {
  readonly id: OrganizationId;
  readonly name: string;
  readonly ein: Ein;
  readonly city: string;
  readonly state: UsState;
  readonly nteeCode: NteeCode;
  readonly annualRevenue: Cents;
}

const requiredText = (value: unknown, field: string): Result<string, ParseError> => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return err(new ParseError(`${field} must be a non-empty string`, { field, received: String(value) }));
  }
  return ok(value.trim());
};

const parse = (value: unknown): Result<Organization, ParseError> => {
  if (typeof value !== 'object' || value === null) {
    return err(new ParseError('organization must be an object', { field: 'organization' }));
  }
  const raw = value as Record<string, unknown>;

  return andThen(requiredText(raw['id'], 'id'), (id) =>
    andThen(requiredText(raw['name'], 'name'), (name) =>
      andThen(requiredText(raw['city'], 'city'), (city) =>
        andThen(Ein.parse(raw['ein']), (ein) =>
          andThen(UsState.parse(raw['state']), (state) =>
            andThen(NteeCode.parse(raw['nteeCode']), (nteeCode) =>
              map(Cents.fromDollars(raw['annualRevenueDollars'] as number), (annualRevenue) => ({
                id: id as OrganizationId,
                name,
                ein,
                city,
                state,
                nteeCode,
                annualRevenue,
              })),
            ),
          ),
        ),
      ),
    ),
  );
};

export const Organization = {
  parse,
  /** The states a funder may sit in and still count as local to this organisation. */
  region: (organization: Organization): ReadonlySet<string> => UsState.region(organization.state),
} as const;
