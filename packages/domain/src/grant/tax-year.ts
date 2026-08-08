import { err, ok, ParseError, type Brand, type Result } from '@merit/shared';

/** The tax year a filing covers. Not the year it was filed -- filings lag by one to two years. */
export type TaxYear = Brand<number, 'TaxYear'>;

/** The IRS began accepting electronic 990s in 2000; anything earlier is a corrupt field. */
const EARLIEST = 2000;
const LATEST = 2100;

const parse = (value: unknown): Result<TaxYear, ParseError> => {
  const year = typeof value === 'string' ? Number(value) : value;
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    return err(
      new ParseError('tax year must be a whole number', { field: 'taxYear', received: String(value) }),
    );
  }
  if (year < EARLIEST || year > LATEST) {
    return err(new ParseError('tax year is outside the filing era', { field: 'taxYear', received: year }));
  }
  return ok(year as TaxYear);
};

export const TaxYear = {
  parse,
  toNumber: (year: TaxYear): number => year as number,
  compare: (a: TaxYear, b: TaxYear): number => (a as number) - (b as number),
} as const;
