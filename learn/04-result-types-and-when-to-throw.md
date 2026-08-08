# 04 — `Result<T, E>` and the Line Between a Failure and a Bug

**TL;DR:** Expected failure is a **value** (`Result<T, E>`); a bug is an **exception**. The interesting design work is deciding which is which — and Merit's answer is unusual: an unrecognised IRS schema version *throws*, on purpose, because silently returning zero grants is the worst thing this system can do.

## The big picture

Every failure in Merit lands in one of three buckets:

```
   Something the user or the network can legitimately do
   ("no such organisation", "database unreachable", "malformed field")
        │
        └──►  Result error value.  The caller handles it. Nothing crashes.

   Something that means our understanding of the world is wrong
   ("this filing uses a schema we have never seen")
        │
        └──►  throw.  Loudly. A human must look at the corpus.

   Something that means the programmer was wrong
   ("null where the type says non-null")
        │
        └──►  throw.  It is a bug, not a runtime condition.
```

Getting bucket 2 right is what separates this codebase from one that quietly loses data.

## What it is

```ts
// packages/shared/src/result.ts:7-15
export type Ok<T>  = { readonly ok: true;  readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok  = <T>(value: T): Ok<T>  => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
```

A discriminated union on the literal field `ok`. TypeScript narrows it automatically:

```ts
const parsed = Organization.parse(input);
if (!parsed.ok) return parsed;    // parsed is Err<ParseError> here
const org = parsed.value;         // and Ok<Organization> here — no cast needed
```

That `if (!x.ok) return x;` line is the single most common statement in the application layer. Read [`create-organization.use-case.ts:23-46`](../packages/application/src/use-cases/create-organization/create-organization.use-case.ts#L23-L46) — it is four of them in a row, and the happy path reads straight down the middle.

### The combinators

`shared/result.ts` ships `map`, `mapErr`, `andThen`, `unwrapOr`, `collect`, `unwrapOrThrow`. Two deserve comment.

**`collect`** fails on the first error rather than accumulating — and says why it is allowed to:

```ts
// packages/shared/src/result.ts:28-31
/**
 * Fails on the first error rather than accumulating. Callers that need every error --
 * a parse-fault report, for instance -- partition the list themselves and keep both sides.
 */
```

The IRS extractors are exactly those callers. They do not use `collect`; they loop and tally, because a filing with 400 grant rows where row 7 is malformed must still yield 399 grants **and** a parse-fault count:

```ts
// packages/infrastructure/src/irs/990-pf.extractor.ts:70-71
if (parsed.ok) grants.push(parsed.value);
else parseFaults += 1;
```

**`unwrapOrThrow`** is the deliberate escape hatch, and its doc comment is the whole justification:

```ts
// packages/shared/src/result.ts:41-44
/**
 * Unwraps a Result that the caller has already established cannot fail. Throws if it did,
 * because reaching here with an error is a bug, not a runtime condition.
 */
```

It is used exactly where that argument holds. `materialityFloor` computes `max(2500, revenue × 0.005)` and hands it to `Cents.fromDollars` — a positive finite number, by construction:

```ts
// packages/domain/src/prospect/materiality-floor.ts:22-25
export const materialityFloor = (annualRevenue: Cents): Cents => {
  const proportional = Cents.toDollars(annualRevenue) * MATERIALITY_FLOOR_RATE;
  return unwrapOrThrow(Cents.fromDollars(Math.max(MATERIALITY_FLOOR_MINIMUM_DOLLARS, proportional)));
};
```

Returning `Result<Cents, ParseError>` here would push an impossible error case onto every caller — including the view-model — forever. The rule of thumb: **`unwrapOrThrow` is acceptable when you can write the one-line proof that it cannot fail.**

## Errors that name themselves

`new Error('failed')` is never acceptable. Every error is a class with a stable code and structured context:

```ts
// packages/shared/src/errors.ts:7-19
export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly context: ErrorContext;

  constructor(message: string, context: ErrorContext = {}) {
    super(message);
    this.name = new.target.name;   // ← the subclass name, not "DomainError"
    this.context = context;
  }

  toJSON() { return { name: this.name, code: this.code, message: this.message, context: this.context }; }
}
```

`new.target.name` is the trick that makes `name` correct without every subclass repeating itself.

The `code` field is what crosses layers. The web layer switches on it, never on the class or the message:

```ts
// apps/web/src/features/organization-profile/actions.ts:34-38
const messageFor = (code: string, message: string): string => {
  if (code === 'duplicate_organization') return 'An organisation with this EIN is already on file.';
  if (code === 'repository_unavailable') return 'The database is unavailable. Nothing was saved.';
  return `That profile could not be saved: ${message}.`;
};
```

The catalogue so far:

| Error | Code | Layer | Meaning |
|---|---|---|---|
| `ParseError` | `parse_error` | shared | External bytes did not match their claimed schema |
| `NotFoundError` | `not_found` | shared | A record that must exist does not |
| `UnknownSchemaVersion` | `unknown_schema_version` | shared | **Thrown, never returned** |
| `RepositoryUnavailable` | `repository_unavailable` | application | Database unreachable or a statement failed |
| `DuplicateOrganization` | `duplicate_organization` | application | This EIN is already on file |
| `IngestInterrupted` | `ingest_interrupted` | application | Stream died; checkpoint left resumable |
| `BundleDownloadFailed` | `bundle_download_failed` | infrastructure | Retries exhausted |

## Why it mattered here — the case for throwing

`UnknownSchemaVersion` is the one that teaches something. Its doc comment:

```ts
// packages/shared/src/errors.ts:32-38
/**
 * A 990 schema version we have never seen. Thrown, never returned: guessing at unseen
 * structure loses data silently, which is the worst failure mode this system has.
 */
export class UnknownSchemaVersion extends DomainError {
  readonly code = 'unknown_schema_version';
}
```

This is not hypothetical. It is thrown in three places, each guarding a real incident:

**1. Unverified schema year** — [`filing-parser.ts:17-22`](../packages/infrastructure/src/irs/filing-parser.ts#L17-L22):
> *"The IRS renames elements between major schema versions, so an unverified year raises rather than extracting zero grants and reporting success — the exact failure that made an earlier validation run report 0 grants for entire bundles."*

**2. Unknown return type** — [`filing-parser.ts:11-15`](../packages/infrastructure/src/irs/filing-parser.ts#L11-L15). A new IRS return type could carry a grant table nobody is reading.

**3. Deflate64 compression** — [`bundle-stream.ts:31-40`](../packages/infrastructure/src/irs/bundle-stream.ts#L31-L40):
> *"An earlier validation run skipped every entry in Deflate64 bundles and reported zero grants. Raising is the whole point: a zero must never be indistinguishable from a parse failure."*

All three share one shape: **a silent skip and a genuine zero produce identical output.** When success and failure are observationally identical, a `Result` the caller might ignore is not enough. Throwing is the only way to guarantee a human finds out.

Note the asymmetry against a *malformed field*, which is a `Result` error counted as a parse fault. The difference: a bad field is one row, measured and reported; an unknown schema is an unknown *number* of rows, silently absent. One is a measurable defect rate, the other is unbounded invisible loss.

## Applied in this project

- [`packages/shared/src/result.ts`](../packages/shared/src/result.ts) — the type and its combinators
- [`packages/shared/src/errors.ts`](../packages/shared/src/errors.ts) — `DomainError` and the base error set
- [`packages/application/src/errors.ts`](../packages/application/src/errors.ts) — application-layer errors
- [`ingest-bundle.use-case.ts:163-182`](../packages/application/src/use-cases/ingest-bundle/ingest-bundle.use-case.ts#L163-L182) — catching a thrown stream failure at the boundary, flushing the checkpoint, and converting to a `Result`
- [`docs/conventions.md`](../docs/conventions.md) — the situation-by-situation table

## Trade-offs / alternatives

**Why not a library (neverthrow, fp-ts, Effect)?** Domain must stay third-party-dependency-free, so any `Result` used in domain has to be ours. Given that, a second implementation elsewhere would be worse than none. The cost is manual `if (!x.ok) return x;` plumbing instead of do-notation — verbose, but explicit and zero-dependency.

**Why not exceptions everywhere?** They are invisible in the type signature. `Promise<Organization>` does not tell you the organisation might not exist; `Promise<Result<Organization, NotFoundError>>` does, and the compiler makes you handle it.

**Why not error accumulation by default?** Most callers want the first failure. The two that do not (parse faults, resolution tallies) are explicit loops, which reads more honestly than a validation-applicative would.

## Learn more

- [TypeScript — Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- [Rust — `Result` and recoverable errors](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html) — the ancestor of this pattern, with the same "which failures are recoverable" argument
- [MDN — `new.target`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/new.target)
- Next: [05 — Branded types and parse, don't validate](05-branded-types-and-parse-dont-validate.md)
