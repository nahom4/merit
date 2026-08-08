import { UsState } from '../organization/us-state.js';

/**
 * Where an announcement says an applicant must be, read from the eligibility text.
 *
 * Grants.gov has no structured field for this. Geography, when it is restricted at all, is
 * stated in prose -- so this is a deliberately conservative scan rather than a parser, and its
 * third state is the important one: an announcement that plainly restricts geography without
 * naming a jurisdiction produces `indeterminate`, never a guess. A wrong `states` verdict hides
 * a live opportunity behind a confident-looking reason, which is the failure mode this project
 * refuses.
 */
export type GeographicRestriction =
  | { readonly kind: 'none' }
  /** US state and territory codes the announcement names. */
  | { readonly kind: 'states'; readonly states: readonly string[]; readonly phrase: string }
  | { readonly kind: 'indeterminate'; readonly phrase: string };

/**
 * Phrases that are about place. A cue alone decides nothing: what follows it inside
 * `CUE_WINDOW` characters has to name a jurisdiction, or at least say that one is meant.
 */
const CUES: readonly RegExp[] = [
  /\blocated\s+(?:in|within)\b/gi,
  /\bmust\s+be\s+located\b/gi,
  /\bresidents?\s+of\b/gi,
  /\bwithin\s+the\b/gi,
  /\blimited\s+to\b/gi,
  /\brestricted\s+to\b/gi,
  /\bonly\s+(?:organizations|organisations|applicants|entities)\b/gi,
  /\bserv(?:e|ing)\b[^.]{0,40}?\b(?:in|within)\b/gi,
];

/** Words that say a jurisdiction is meant even when none is named. */
const JURISDICTION_WORDS =
  /\b(state|states|statewide|commonwealth|territory|territories|county|counties|region|regions|city|cities|tribal lands)\b/i;

/**
 * How far after a cue a jurisdiction may sit. The real case this is sized for reads
 * "within the eight Mississippi Delta Region States (Alabama, Arkansas, ... Tennessee)" --
 * 100 characters between cue and last name. Wider than this starts collecting the agency's
 * own address.
 */
const CUE_WINDOW = 220;

const statesIn = (fragment: string): string[] => {
  const found: string[] = [];
  let remaining = fragment;

  // Longest name first, and each match is removed, so "West Virginia" is never read as
  // "Virginia" and a name is never counted twice.
  for (const [name, code] of UsState.namePairs()) {
    const pattern = new RegExp(`\\b${name}\\b`, 'gi');
    if (pattern.test(remaining)) {
      found.push(code);
      remaining = remaining.replace(pattern, ' ');
    }
  }
  return found;
};

const tidy = (fragment: string): string => fragment.replace(/\s+/g, ' ').trim();

export const detectGeographicRestriction = (eligibilityText: string | null): GeographicRestriction => {
  if (eligibilityText === null || eligibilityText.trim().length === 0) return { kind: 'none' };

  const states = new Set<string>();
  let statesPhrase: string | null = null;
  let jurisdictionPhrase: string | null = null;

  for (const cue of CUES) {
    // Each regex is module-level and global, so `lastIndex` has to be reset per call or the
    // second document scanned starts wherever the first one finished.
    cue.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = cue.exec(eligibilityText)) !== null) {
      const window = eligibilityText.slice(match.index, match.index + CUE_WINDOW);
      const named = statesIn(window);

      if (named.length > 0) {
        for (const code of named) states.add(code);
        statesPhrase ??= tidy(window);
      } else if (JURISDICTION_WORDS.test(window)) {
        jurisdictionPhrase ??= tidy(window);
      }
    }
  }

  if (states.size > 0) return { kind: 'states', states: [...states], phrase: statesPhrase ?? '' };
  if (jurisdictionPhrase !== null) return { kind: 'indeterminate', phrase: jurisdictionPhrase };
  return { kind: 'none' };
};

/**
 * Which country an announcement is open to. Merit's organisations are US filers, so the only
 * verdict that excludes one is `foreign_only`; `us_only` is the common case and it is a pass.
 */
export type CountryRestriction = 'us_only' | 'foreign_only' | 'none';

const FOREIGN_ONLY =
  // No trailing word boundary: "non-U.S." ends in a full stop, and `\b` between "." and a
  // space matches nothing.
  /\bonly\s+(?:non-domestic|non-U\.S\.|non-US|foreign)|\bmust\s+be\s+(?:a\s+)?foreign\b/i;

/** The two wordings the live feed actually uses to bar foreign applicants, plus the positive
 *  form ("domestic ... entities") that says the same thing the other way round. */
const US_ONLY =
  /(?:foreign|non-domestic|non-U\.S\.|non-US)[^.]{0,120}?\bnot\s+(?:eligible|allowed)\b|\bdomestic\s+(?:public\s+or\s+private,?\s+)?(?:non-?profit\s+)?(?:entities|organizations|organisations|applicants)\b|\bU\.S\.-based\b/i;

export const detectCountryRestriction = (eligibilityText: string | null): CountryRestriction => {
  if (eligibilityText === null || eligibilityText.trim().length === 0) return 'none';
  if (FOREIGN_ONLY.test(eligibilityText)) return 'foreign_only';
  if (US_ONLY.test(eligibilityText)) return 'us_only';
  return 'none';
};
