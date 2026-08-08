import { err, ok, ParseError, type Brand, type Result } from '@merit/shared';

/** Money is integer cents. Never a float -- medians and sums over 1.4M grants must not drift. */
export type Cents = Brand<number, 'Cents'>;

const parse = (value: unknown): Result<Cents, ParseError> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return err(
      new ParseError('amount must be a finite number', { field: 'amount', received: String(value) }),
    );
  }
  if (!Number.isInteger(value)) {
    return err(new ParseError('amount must be whole cents', { field: 'amount', received: value }));
  }
  if (value < 0) {
    return err(new ParseError('amount must not be negative', { field: 'amount', received: value }));
  }
  return ok(value as Cents);
};

export const Cents = {
  parse,
  /** IRS filings state grant amounts in whole dollars; revenue figures may carry cents. */
  fromDollars: (dollars: number): Result<Cents, ParseError> =>
    typeof dollars === 'number' && Number.isFinite(dollars)
      ? parse(Math.round(dollars * 100))
      : err(new ParseError('amount must be a finite number', { field: 'amount', received: String(dollars) })),
  toNumber: (cents: Cents): number => cents as number,
  toDollars: (cents: Cents): number => (cents as number) / 100,
} as const;
