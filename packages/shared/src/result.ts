/**
 * Expected failure is a value, not an exception (docs/conventions.md).
 *
 * Domain and application code returns `Result`. A thrown error means the programmer
 * was wrong -- not the user, and not the network.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

export const map = <T, U, E>(result: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  result.ok ? ok(f(result.value)) : result;

export const mapErr = <T, E, F>(result: Result<T, E>, f: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(f(result.error));

export const andThen = <T, U, E>(result: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> =>
  result.ok ? f(result.value) : result;

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T => (result.ok ? result.value : fallback);

/**
 * Fails on the first error rather than accumulating. Callers that need every error --
 * a parse-fault report, for instance -- partition the list themselves and keep both sides.
 */
export const collect = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

/**
 * Unwraps a Result that the caller has already established cannot fail. Throws if it did,
 * because reaching here with an error is a bug, not a runtime condition.
 */
export const unwrapOrThrow = <T, E>(result: Result<T, E>): T => {
  if (result.ok) return result.value;
  throw new Error(`unwrapOrThrow on an error result: ${JSON.stringify(result.error)}`);
};
