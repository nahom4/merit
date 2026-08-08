/**
 * The mechanism for branded types. The vocabulary -- `Ein`, `Cents`, `TaxYear` -- lives in
 * `packages/domain`, because those are domain words. This file only supplies the brand.
 *
 * A branded type is constructible only inside the parse function that has just validated it,
 * which is the whole point: an `Ein` in scope has already been checked.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Erases the brand for storage or serialisation. */
export const unbrand = <T, B extends string>(value: Brand<T, B>): T => value as T;
