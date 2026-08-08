# 05 — Branded Types and "Parse, Don't Validate"

**TL;DR:** An EIN is not a string and money is not a float. Merit gives identifiers and quantities *branded* types that can only be constructed by a parse function, so having one in scope is proof it was checked. Every external byte — XML, CSV, form field, env var, database row — is parsed at the edge exactly once; inside the boundary, types are trusted because they were earned.

## The big picture

```
  OUTSIDE (unknown)                    THE EDGE                    INSIDE (trusted)
  ────────────────────────────────────────────────────────────────────────────────
  IRS 990 XML            ─┐
  IRS BMF CSV             │
  Grants.gov JSON         ├──►  a parse function  ──►  branded domain type
  HTML form field         │     returns Result         Ein, Cents, NteeCode,
  process.env             │                            UsState, Organization,
  libSQL row             ─┘                            GrantRecord
```

Two rules make the diagram true:

1. **Nothing crosses the edge except through a parse function.** Untrusted input enters as `unknown`, never `any`.
2. **The type on the right is unforgeable.** You cannot write `const e: Ein = "123"` — the compiler refuses.

Rule 2 is what makes rule 1 enforceable rather than aspirational.

## What a branded type is

TypeScript is structurally typed: any `string` is assignable to any other `string`. That means `Ein`, `OrganizationId`, and a ZIP code are all the same type, and passing one where another is expected compiles fine. Branding fixes this by intersecting with a phantom property:

```ts
// packages/shared/src/branded.ts:8-11
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Erases the brand for storage or serialisation. */
export const unbrand = <T, B extends string>(value: Brand<T, B>): T => value as T;
```

`__brand` never exists at runtime — it is purely a compile-time marker. A `Brand<string, 'Ein'>` is a `string` in every way that matters to V8, and a distinct type to `tsc`.

The mechanism lives in `shared`; the *vocabulary* lives in domain, and the file says why:

```ts
// packages/shared/src/branded.ts:1-7
/**
 * The mechanism for branded types. The vocabulary -- `Ein`, `Cents`, `TaxYear` -- lives in
 * `packages/domain`, because those are domain words. This file only supplies the brand.
 *
 * A branded type is constructible only inside the parse function that has just validated it,
 * which is the whole point: an `Ein` in scope has already been checked.
 */
```

## The pattern: a type plus a namespace object

Every branded value in Merit follows one shape — `type X` and `const X` sharing a name (TypeScript allows this; they live in different declaration spaces):

```ts
// packages/domain/src/shared/ein.ts:28-32
export const Ein = {
  parse,
  toString: (ein: Ein): string => ein as string,
  equals: (a: Ein, b: Ein): boolean => (a as string) === (b as string),
} as const;
```

So `Ein.parse(x)` gives you a `Result<Ein, ParseError>`, and `Ein.toString(e)` gets you back out. The `as Ein` cast appears **only inside `parse`**, immediately after validation — that is the one place `docs/conventions.md` permits a type assertion.

## Example — `Ein`, and why real data is messy

```ts
// packages/domain/src/shared/ein.ts:6-26
/**
 * The IRS prints EINs hyphenated, files them unhyphenated, and the BMF CSV loses leading
 * zeros to spreadsheet software. All three spellings name the same organisation, so parsing
 * normalises to nine digits and comparison happens on the normalised form only.
 */
const parse = (value: unknown): Result<Ein, ParseError> => {
  if (typeof value !== 'string') return err(new ParseError('ein must be a string', …));

  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{1,9}$/.test(digits)) return err(new ParseError('ein must be nine digits', …));

  const padded = digits.padStart(9, '0');
  if (padded === '000000000') {
    // Filings use all-zeros where the preparer had no EIN to give. That is absence,
    // not an identifier, and linking on it would merge unrelated organisations.
    return err(new ParseError('ein 000000000 means "not stated"', …));
  }
  return ok(padded as Ein);
};
```

Three things worth stealing from this:

- **Normalisation belongs in the parse, not at the call site.** `58-1613254`, `581613254`, and `81613254` (Excel ate the leading zero) all become `058161325`… — one canonical form, so equality is just string comparison. If normalisation lived at call sites, the corpus would silently fail to join.
- **A sentinel is not a value.** `000000000` is how filings spell "the preparer had no EIN". Accepting it would merge every such recipient into a single fictional mega-organisation. This is a *domain* fact, encoded once, where it cannot be forgotten.
- **The `Result` error carries context** (`{ field: 'ein', received: value }`) so a parse fault is diagnosable from a log line.

### `Cents` — money is an integer

```ts
// packages/domain/src/shared/money.ts:3-4
/** Money is integer cents. Never a float -- medians and sums over 1.4M grants must not drift. */
export type Cents = Brand<number, 'Cents'>;
```

`parse` rejects non-finite, non-integer, and negative values. `fromDollars` is the boundary helper (IRS filings state whole dollars), and the schema follows through: `amount_cents INTEGER` in [`0002-create-giving-graph.sql:3-4`](../packages/infrastructure/src/persistence/migrations/0002-create-giving-graph.sql#L3-L4), with the comment *"a REAL column would drift."*

This is the classic float-money bug, but at a scale where it actually bites: summing 1.4M IEEE-754 doubles accumulates error, and the product's central number is a **median grant amount** used to decide whether a nonprofit should spend forty hours on an application.

### Composing parsers — `Organization`

Larger types compose the small ones with `andThen`, so the first failure short-circuits and its `ParseError` propagates untouched:

```ts
// packages/domain/src/organization/organization.ts:37-57 (abridged)
return andThen(requiredText(raw['id'], 'id'), (id) =>
  andThen(requiredText(raw['name'], 'name'), (name) =>
    andThen(Ein.parse(raw['ein']), (ein) =>
      andThen(UsState.parse(raw['state']), (state) =>
        andThen(NteeCode.parse(raw['nteeCode']), (nteeCode) =>
          map(Cents.fromDollars(raw['annualRevenueDollars'] as number), (annualRevenue) => ({
            id: id as OrganizationId, name, ein, city, state, nteeCode, annualRevenue,
          })))))));
```

The nesting is the honest cost of doing this without a library (domain may not import Zod — see [note 02](02-the-layered-architecture.md)). What you get: an `Organization` value that **cannot exist** unless its EIN is nine valid digits, its state is a real US jurisdiction, its NTEE code is well-formed, and its revenue is non-negative integer cents.

Look at what that buys the layer above. [`prospect-list/view-model.ts`](../apps/web/src/features/prospect-list/view-model.ts) has no defensive checks, no `?? 'unknown'` on required fields, no re-validation. It reads fields, because they were earned.

## Zod, at the boundaries domain cannot reach

Domain is Zod-free by rule. Infrastructure is not — and uses it exactly where the input is a foreign document:

```ts
// packages/infrastructure/src/config.ts:3-23 (abridged)
/**
 * Every environment variable Merit reads, declared once and parsed at boot.
 * Missing config fails loudly on startup, never on first use at 3am.
 */
const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required, e.g. file:./data/merit.db'),
  IRS_BUNDLE_BASE_URL: z.string().url().default('https://apps.irs.gov/pub/epostcard/990/xml'),
  IRS_CORPUS_YEAR: z.coerce.number().int().min(2015).max(2100).default(2025),
  /** Every outbound call has an explicit timeout. A default is not a policy. */
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});
```

`loadConfig` throws (not `Result`) with every issue listed and a pointer to `.env.example` — because misconfiguration at boot is a deployment bug, not a runtime condition. That is the [note 04](04-result-types-and-when-to-throw.md) rule applied consistently.

The XML side gets the same treatment through a different tool. `fast-xml-parser` is configured to **never coerce**:

```ts
// packages/infrastructure/src/irs/filing-parser.ts:44-46
// Every text node stays a string: an EIN with a leading zero must not become a number,
// and an amount is parsed by the domain, not by the XML library.
parseTagValue: false,
parseAttributeValue: false,
```

If the XML library were allowed to guess types, `"058161325"` becomes `58161325` and the join key is destroyed before any parse function sees it. **The edge parser must not have opinions.**

## Why it mattered here

Merit's entire value is a join: recipient strings from filings, matched against a 1.8M-row registry, aggregated into signals, ranked into a prospect list. Every step is an equality or an arithmetic operation on identifiers and money. If an EIN can be two spellings or an amount can be a float, the join silently produces *plausible but wrong* answers — which is worse than an error, because a development director will take it to a board.

## Applied in this project

- [`packages/shared/src/branded.ts`](../packages/shared/src/branded.ts) — the `Brand` mechanism
- [`packages/domain/src/shared/ein.ts`](../packages/domain/src/shared/ein.ts) · [`money.ts`](../packages/domain/src/shared/money.ts) — the two most-used branded types
- [`packages/domain/src/organization/organization.ts`](../packages/domain/src/organization/organization.ts) — composing parsers
- [`packages/infrastructure/src/config.ts`](../packages/infrastructure/src/config.ts) — Zod at the env boundary
- [`packages/infrastructure/src/irs/filing-parser.ts:40-50`](../packages/infrastructure/src/irs/filing-parser.ts#L40-L50) — the no-coercion XML parser

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Plain `string` / `number` with runtime checks at call sites | The check is forgettable; the type says nothing; nothing stops a ZIP being passed as an EIN |
| Zod everywhere including domain | Domain would grow a third-party dependency, breaking [ADR-0004](../docs/decisions/0004-domain-may-import-shared.md) and the 100%-coverage-without-fixtures property |
| Classes instead of branded primitives | Allocation per value across ~2M grant records, and awkward serialisation to and from SQL |

The honest cost of branding: `unbrand` / `as string` casts at every serialisation point, and the deeply nested `andThen` chain above. Both are visible, local, and compiler-checked — which is the trade Merit is happy to make.

## Learn more

- [Alexis King — Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — the essay this whole note is an application of
- [TypeScript — nominal typing (issue #202)](https://github.com/microsoft/TypeScript/issues/202) — why branding is needed at all
- [Zod documentation](https://zod.dev)
- [fast-xml-parser options](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4/2.XMLparseOptions.md)
