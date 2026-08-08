import { err, ok, ParseError, type Brand, type Result } from '@merit/shared';

/**
 * An NTEE program code as the IRS Business Master File carries it: a major group letter
 * followed by up to three alphanumeric characters. `B60` is adult literacy.
 *
 * The BMF publishes more shapes than the familiar three-character one. Alongside `B60` and
 * `B60Z` it carries a four-character deciles form -- `A116`, `A6E0`, `A6EZ` -- and a handful
 * of two-character codes. Only the first character is load-bearing here (peer matching blocks
 * on the major group), so the rule is deliberately shaped to the field rather than to the
 * tidier subset of it: 147,935 of 1.4M registry rows use the four-character form, and a
 * stricter rule silently excluded every one of them from being profiled or counted as a peer.
 */
export type NteeCode = Brand<string, 'NteeCode'>;

/** The 26 NTEE major groups, in the words a development director would use. */
const MAJOR_GROUPS: Readonly<Record<string, string>> = {
  A: 'Arts, Culture and Humanities',
  B: 'Education',
  C: 'Environment',
  D: 'Animal Related',
  E: 'Health Care',
  F: 'Mental Health and Crisis Intervention',
  G: 'Voluntary Health Associations and Medical Disciplines',
  H: 'Medical Research',
  I: 'Crime and Legal Related',
  J: 'Employment',
  K: 'Food, Agriculture and Nutrition',
  L: 'Housing and Shelter',
  M: 'Public Safety, Disaster Preparedness and Relief',
  N: 'Recreation and Sports',
  O: 'Youth Development',
  P: 'Human Services',
  Q: 'International, Foreign Affairs and National Security',
  R: 'Civil Rights, Social Action and Advocacy',
  S: 'Community Improvement and Capacity Building',
  T: 'Philanthropy, Voluntarism and Grantmaking Foundations',
  U: 'Science and Technology',
  V: 'Social Science',
  W: 'Public and Societal Benefit',
  X: 'Religion Related',
  Y: 'Mutual and Membership Benefit',
  Z: 'Unknown',
};

const parse = (value: unknown): Result<NteeCode, ParseError> => {
  if (typeof value !== 'string') {
    return err(new ParseError('ntee code must be a string', { field: 'nteeCode', received: typeof value }));
  }
  const code = value.trim().toUpperCase();
  if (!/^[A-Z][0-9A-Z]{0,3}$/.test(code)) {
    return err(
      new ParseError('ntee code must be a letter followed by up to three alphanumerics', {
        field: 'nteeCode',
        received: value,
      }),
    );
  }
  return ok(code as NteeCode);
};

const majorGroup = (code: NteeCode): string => (code as string).charAt(0);

export const NteeCode = {
  parse,
  toString: (code: NteeCode): string => code as string,
  majorGroup,
  majorGroupLabel: (code: NteeCode): string => MAJOR_GROUPS[majorGroup(code)] ?? 'Unknown',
  /** The same label from a bare major-group letter, which is all a grantee row carries once
   *  the registry code has been reduced to the character peer matching blocks on. */
  labelForMajorGroup: (letter: string): string => MAJOR_GROUPS[letter.toUpperCase()] ?? 'Unknown',
  /** Peer matching blocks on the major group: B60 and B92 are both education. */
  sharesMajorGroup: (a: NteeCode, b: NteeCode): boolean => majorGroup(a) === majorGroup(b),
} as const;
