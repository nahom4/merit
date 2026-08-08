/**
 * Normalisation for record linkage. Applied identically to both sides -- the free-text
 * recipient string from a filing, and the canonical name from the IRS registry. Applying it
 * to only one side is the classic way to get a resolution pipeline that quietly matches
 * nothing.
 */

/** Expanded, never contracted: one target spelling per concept. */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  '&': 'AND',
  ST: 'SAINT',
  STE: 'SAINT',
  MT: 'MOUNT',
  NATL: 'NATIONAL',
  NATIONL: 'NATIONAL',
  INTL: 'INTERNATIONAL',
  INTERNATL: 'INTERNATIONAL',
  ASSOC: 'ASSOCIATION',
  ASSN: 'ASSOCIATION',
  ASSOCIATES: 'ASSOCIATION',
  UNIV: 'UNIVERSITY',
  CTR: 'CENTER',
  CTRS: 'CENTERS',
  CENTRE: 'CENTER',
  CENTRES: 'CENTERS',
  DEPT: 'DEPARTMENT',
  SVC: 'SERVICE',
  SVCS: 'SERVICES',
  SERV: 'SERVICE',
  SERVS: 'SERVICES',
  FDN: 'FOUNDATION',
  FND: 'FOUNDATION',
  FOUND: 'FOUNDATION',
  CHTY: 'CHARITY',
  SOC: 'SOCIETY',
  INST: 'INSTITUTE',
  HOSP: 'HOSPITAL',
  MEM: 'MEMORIAL',
  MEML: 'MEMORIAL',
  AMER: 'AMERICAN',
  COMM: 'COMMUNITY',
  CMTY: 'COMMUNITY',
  DEV: 'DEVELOPMENT',
  EDUC: 'EDUCATION',
  CO: 'COMPANY',
  ORG: 'ORGANIZATION',
  ORGANISATION: 'ORGANIZATION',
  TR: 'TRUST',
  TUA: 'TRUST',
};

/**
 * Legal form, not identity. Stripped only from the end of the name -- "Incarnation House"
 * must not become "arnation House", and a suffix in the middle of a name is part of it.
 */
const LEGAL_SUFFIXES = new Set([
  'INC',
  'INCORPORATED',
  'LLC',
  'LLP',
  'LP',
  'CORP',
  'CORPORATION',
  'COMPANY',
  'LTD',
  'PC',
  'PA',
  'NA',
]);

/** Words too common to distinguish two organisations from each other. */
const STOP_WORDS = new Set(['OF', 'THE', 'AND', 'FOR', 'A', 'AN', 'IN', 'AT', 'TO']);

export const normalizeName = (raw: string): string => {
  const stripped = raw
    .toUpperCase()
    // Possessives are a spelling variant, not a different organisation: "St. Patrick's
    // Catholic School" and "ST PATRICK CATHOLIC SCHOOL" are one entity. Handled before
    // punctuation is stripped, so that plurals ("BOYS", "CENTERS") are left alone.
    .replace(/['’]S\b/g, '')
    .replace(/&/g, ' & ')
    // Punctuation is noise: "St. Patrick's" and "ST PATRICKS" are one organisation.
    .replace(/[^A-Z0-9&\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length === 0) return '';

  const expanded = stripped.split(' ').map((token) => ABBREVIATIONS[token] ?? token);

  // Filings are inconsistent about a leading article; a trailing one never occurs.
  const withoutArticle = expanded[0] === 'THE' ? expanded.slice(1) : expanded;

  const withoutSuffixes = [...withoutArticle];
  while (withoutSuffixes.length > 1 && LEGAL_SUFFIXES.has(withoutSuffixes[withoutSuffixes.length - 1]!)) {
    withoutSuffixes.pop();
  }

  return withoutSuffixes.join(' ');
};

export const tokensOf = (normalized: string): ReadonlySet<string> =>
  new Set(normalized.split(' ').filter((token) => token.length > 0 && !STOP_WORDS.has(token)));

const SOUNDEX_CODES: Readonly<Record<string, string>> = {
  B: '1',
  F: '1',
  P: '1',
  V: '1',
  C: '2',
  G: '2',
  J: '2',
  K: '2',
  Q: '2',
  S: '2',
  X: '2',
  Z: '2',
  D: '3',
  T: '3',
  L: '4',
  M: '5',
  N: '5',
  R: '6',
};

/**
 * Soundex, used only as a blocking key -- never as a match. It is deliberately loose: a block
 * that is slightly too wide costs comparisons, while a block that is too narrow loses the
 * true match before scoring ever sees it.
 */
export const soundex = (word: string): string => {
  const letters = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length === 0) return '';

  const first = letters[0]!;
  let code = first;
  let previous = SOUNDEX_CODES[first] ?? '';

  for (const letter of letters.slice(1)) {
    const digit = SOUNDEX_CODES[letter] ?? '';
    if (digit !== '' && digit !== previous) code += digit;
    // H and W are transparent: they do not break a run of the same code.
    if (letter !== 'H' && letter !== 'W') previous = digit;
    if (code.length === 4) break;
  }

  return code.padEnd(4, '0');
};

/**
 * Comparing a recipient string against 1.8M registry rows pairwise is infeasible, so
 * candidates are blocked on state plus the phonetic code of the first significant token.
 */
export const blockingKey = (normalized: string, state: string): string | null => {
  const [first] = [...tokensOf(normalized)];
  if (first === undefined) return null;
  const code = soundex(first);
  if (code === '') return null;
  return `${state.toUpperCase()}:${code}`;
};
