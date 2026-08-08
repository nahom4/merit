import { err, ok, ParseError, type Brand, type Result } from '@merit/shared';

/** A US jurisdiction that files with the IRS: the 50 states, DC, and the territories. */
export type UsState = Brand<string, 'UsState'>;

/**
 * Land borders. A funding "region" is the state plus the states it touches -- the definition
 * used in validation/analyze.py, which produced the coverage numbers in validation/RESULTS.txt.
 * Foundations give locally, and a state line is not a wall; a Charlotte funder is a live
 * prospect for a Rock Hill charity twenty miles away.
 */
const BORDERS: Readonly<Record<string, readonly string[]>> = {
  AL: ['FL', 'GA', 'MS', 'TN'],
  AK: [],
  AZ: ['CA', 'CO', 'NV', 'NM', 'UT'],
  AR: ['LA', 'MS', 'MO', 'OK', 'TN', 'TX'],
  CA: ['AZ', 'NV', 'OR'],
  CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
  CT: ['MA', 'NY', 'RI'],
  DE: ['MD', 'NJ', 'PA'],
  DC: ['MD', 'VA'],
  FL: ['AL', 'GA'],
  GA: ['AL', 'FL', 'NC', 'SC', 'TN'],
  HI: [],
  ID: ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
  IL: ['IN', 'IA', 'KY', 'MO', 'WI'],
  IN: ['IL', 'KY', 'MI', 'OH'],
  IA: ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'],
  KS: ['CO', 'MO', 'NE', 'OK'],
  KY: ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'],
  LA: ['AR', 'MS', 'TX'],
  ME: ['NH'],
  MD: ['DC', 'DE', 'PA', 'VA', 'WV'],
  MA: ['CT', 'NH', 'NY', 'RI', 'VT'],
  MI: ['IN', 'OH', 'WI'],
  MN: ['IA', 'ND', 'SD', 'WI'],
  MS: ['AL', 'AR', 'LA', 'TN'],
  MO: ['AR', 'IL', 'IA', 'KS', 'KY', 'NE', 'OK', 'TN'],
  MT: ['ID', 'ND', 'SD', 'WY'],
  NE: ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'],
  NV: ['AZ', 'CA', 'ID', 'OR', 'UT'],
  NH: ['ME', 'MA', 'VT'],
  NJ: ['DE', 'NY', 'PA'],
  NM: ['AZ', 'CO', 'OK', 'TX', 'UT'],
  NY: ['CT', 'MA', 'NJ', 'PA', 'VT'],
  NC: ['GA', 'SC', 'TN', 'VA'],
  ND: ['MN', 'MT', 'SD'],
  OH: ['IN', 'KY', 'MI', 'PA', 'WV'],
  OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'],
  OR: ['CA', 'ID', 'NV', 'WA'],
  PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'],
  RI: ['CT', 'MA'],
  SC: ['GA', 'NC'],
  SD: ['IA', 'MN', 'MT', 'NE', 'ND', 'WY'],
  TN: ['AL', 'AR', 'GA', 'KY', 'MS', 'MO', 'NC', 'VA'],
  TX: ['AR', 'LA', 'NM', 'OK'],
  UT: ['AZ', 'CO', 'ID', 'NV', 'NM', 'WY'],
  VT: ['MA', 'NH', 'NY'],
  VA: ['DC', 'KY', 'MD', 'NC', 'TN', 'WV'],
  WA: ['ID', 'OR'],
  WV: ['KY', 'MD', 'OH', 'PA', 'VA'],
  WI: ['IA', 'IL', 'MI', 'MN'],
  WY: ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'],
  // Territories file with the IRS and appear in the BMF. None has a land border.
  PR: [],
  VI: [],
  GU: [],
  AS: [],
  MP: [],
};

const parse = (value: unknown): Result<UsState, ParseError> => {
  if (typeof value !== 'string') {
    return err(new ParseError('state must be a string', { field: 'state', received: typeof value }));
  }
  const code = value.trim().toUpperCase();
  if (!Object.hasOwn(BORDERS, code)) {
    return err(new ParseError('state must be a US jurisdiction code', { field: 'state', received: value }));
  }
  return ok(code as UsState);
};

export const UsState = {
  parse,
  toString: (state: UsState): string => state as string,
  /** The state plus every state it borders. Always contains the state itself. */
  region: (state: UsState): ReadonlySet<string> =>
    new Set([state as string, ...(BORDERS[state as string] ?? [])]),
  all: (): readonly string[] => Object.keys(BORDERS),
} as const;
