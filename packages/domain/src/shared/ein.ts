import { err, ok, ParseError, type Brand, type Result } from '@merit/shared';

/** A US Employer Identification Number. An EIN is not a string. */
export type Ein = Brand<string, 'Ein'>;

/**
 * The IRS prints EINs hyphenated, files them unhyphenated, and the BMF CSV loses leading
 * zeros to spreadsheet software. All three spellings name the same organisation, so parsing
 * normalises to nine digits and comparison happens on the normalised form only.
 */
const parse = (value: unknown): Result<Ein, ParseError> => {
  if (typeof value !== 'string') {
    return err(new ParseError('ein must be a string', { field: 'ein', received: typeof value }));
  }
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{1,9}$/.test(digits)) {
    return err(new ParseError('ein must be nine digits', { field: 'ein', received: value }));
  }
  const padded = digits.padStart(9, '0');
  if (padded === '000000000') {
    // Filings use all-zeros where the preparer had no EIN to give. That is absence,
    // not an identifier, and linking on it would merge unrelated organisations.
    return err(new ParseError('ein 000000000 means "not stated"', { field: 'ein', received: value }));
  }
  return ok(padded as Ein);
};

export const Ein = {
  parse,
  toString: (ein: Ein): string => ein as string,
  equals: (a: Ein, b: Ein): boolean => (a as string) === (b as string),
} as const;
