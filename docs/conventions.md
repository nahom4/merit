# Conventions

Consistency beats cleverness. When in doubt, copy the nearest existing example.

---

## Naming

### Files — always `kebab-case.ts`

| Kind | Pattern | Example |
|---|---|---|
| Domain type | `<concept>.ts` | `funder-signals.ts` |
| Domain policy | `<verb>-<noun>.ts` | `compute-turnover.ts` |
| Use case | `<verb>-<noun>.use-case.ts` | `score-prospects.use-case.ts` |
| Port | `<noun>.port.ts` | `funder-repository.port.ts` |
| Adapter | `<vendor>-<noun>.<kind>.ts` | `libsql-funder.repository.ts`, `grants-gov-search.gateway.ts` |
| Schema | `<noun>.schema.ts` | `grants-gov-opportunity.schema.ts` |
| React component | `<noun>.tsx` | `prospect-card.tsx` |
| View-model | `view-model.ts` | `features/prospect-list/view-model.ts` |
| Unit test | `<subject>.test.ts` | colocated with the subject |
| Integration test | `<subject>.int.test.ts` | `tests/integration/` |
| Contract test | `<vendor>.contract.test.ts` | `tests/contract/` |
| E2E | `<slice>.spec.ts` | `tests/e2e/` |
| Migration | `NNNN-<description>.sql` | `0003-add-entity-links.sql` |

### Symbols

| Kind | Case | Example |
|---|---|---|
| Types, classes, components | `PascalCase` | `FunderSignals`, `ProspectCard` |
| Functions, variables | `camelCase` | `computeTurnover` |
| Constants | `UPPER_SNAKE` | `MATERIALITY_FLOOR_RATE` |
| Ports | `PascalCase` + role suffix | `FunderRepository`, `LlmGateway`, `Clock` |
| Use cases | verb-first class, one `execute` method | `ScoreProspects.execute(input)` |
| Booleans | `is` / `has` / `can` | `isReachable`, `hasStatedEin` |
| Zod schemas | `<Thing>Schema` | `OpportunitySchema` |

### Vocabulary — use the domain's words, not synonyms

The design document sets the language. Do not introduce alternatives.

| Use | Never |
|---|---|
| `funder` | grantor, donor, foundation (as a variable) |
| `grantee` | recipient organisation |
| `recipientString` | the raw unresolved text on a filing |
| `entity` | a resolved, registry-anchored organisation |
| `prospect` | lead, target |
| `pursuit` | application, submission |
| `openness`, `affinity`, `geographyFit`, `sizeFit` | the four score components, always these names |
| `competitiveBaseRate` | win rate, win probability, odds |
| `signals` | metrics, stats |

Renaming a domain concept is an ADR, not a refactor.

---

## Types

```ts
// Branded types for identifiers. An EIN is not a string.
type Ein = string & { readonly __brand: 'Ein' };
export const Ein = { parse: (v: unknown): Result<Ein, ParseError> => ... };

// Money is integer cents. Never a float.
type Cents = number & { readonly __brand: 'Cents' };
```

- **No `any`.** Untrusted input is `unknown` until parsed.
- **No type assertions** (`as Foo`) outside a parse function that has just validated the value.
- **`readonly` by default** on domain types. Domain objects do not mutate.
- **Discriminated unions over optional fields.** `LinkDecision = Linked | Rejected | NeedsReview`, not one object with three nullable fields.
- **Exhaustive switches** with a `never` default. The compiler should break when a case is added.

---

## Errors

Expected failure is a value. Bugs throw.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

| Situation | Handling |
|---|---|
| Organisation not found | `Result` error — expected |
| Malformed IRS field | `Result` error, counted as a parse fault, filing flagged |
| Unknown 990 schema version | **Throw.** We must not guess at unseen structure |
| Gemini quota exhausted | `Result` error — serve persisted results, queue the work |
| Model returned invalid JSON | Repair loop, then `Result` error |
| Null where the type says non-null | Throw. That is a bug |

Error types are named and carry context: `class UnknownSchemaVersion extends DomainError`
with the version and object ID attached. `new Error('failed')` is never acceptable.

**Every error crossing a boundary is logged once, with correlation ID, at the boundary.**
Not at every level on the way up.

---

## Zod at every boundary

Parse at the edge, trust inside.

```ts
// infrastructure/grants-gov/opportunity.schema.ts
const RawOpportunitySchema = z.object({
  id: z.string(),
  number: z.string(),
  closeDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  cfdaList: z.array(z.string()).default([]),
});

// The gateway returns a domain type, never the raw shape.
export async function fetchOpportunity(id: string): Promise<Result<Opportunity, GatewayError>>
```

Boundaries that require a schema: IRS XML, IRS BMF CSV, Grants.gov, USASpending, ProPublica,
every Gemini response, every API route input, every form submission, every database row.

---

## Async and I/O

- **No `fetch` outside `infrastructure`.** Ever.
- **Every outbound call has a timeout** and an explicit retry policy with jitter. Defaults are not a policy.
- **Streams for anything over a megabyte.** No `readFile` on an IRS bundle.
- **No `Date.now()` or `Math.random()` outside the `Clock` and `IdGenerator` adapters.**
- **Long jobs checkpoint before work, not after.** Assume the process dies mid-record.

---

## React and UI

- **Server components by default.** `'use client'` requires a reason: interactivity or browser API.
- **No data fetching in components.** Server components call use cases; client components receive props or call server actions.
- **Formatting lives in the view-model**, which is pure and unit-tested. JSX contains no `toLocaleString`, no bucketing, no conditional label logic.
- **Every list has an explicit empty state that explains itself.** "No comparable organisations found in NC for this program area" — never a blank panel.
- **Loading, error, and empty are designed at the same time as the success state**, not retrofitted.
- **Tailwind, no inline styles.** Repeated clusters become a primitive in `components/ui/`.
- **Accessible by default:** semantic elements, labelled controls, keyboard reachable, visible focus. Data tables are tables.
- **Responsive by default.** Every surface works on a laptop and a phone.

---

## Configuration and secrets

- All environment variables declared in one Zod schema, parsed once at startup. Missing config fails loudly on boot, never on first use at 3am.
- **No secrets in the repo.** `.env.example` documents every key with a comment on where to get it.
- Free tier is a hard constraint. Adding a paid dependency is an ADR.

---

## Git

**Conventional Commits**, with the slice in scope:

```
feat(prospects): rank funders by openness and affinity
fix(ingest): resume from checkpoint after dropped SSL connection
test(resolution): add held-out precision measurement
refactor(domain): extract materiality floor into a value object
docs(adr): record why entity resolution anchors on the BMF
```

- Branch: `slice/<n>-<name>`, e.g. `slice/1-prospect-discovery`.
- Small commits, each one green. A red commit on a shared branch is a broken build for everyone.
- PR description states: what slice, what behaviour, which tests prove it.
- No merge without `pnpm gate` green.

---

## Comments

Code says what. Comments say **why**, and only when the why is not obvious.

```ts
// ✗ increments the counter
counter++;

// ✓ The IRS server drops SSL connections mid-transfer on large bundles, so partial
//   progress must be durable before the next read — not after the batch completes.
await checkpoint.save(offset);
```

Every non-obvious constant cites its source:

```ts
/** 0.5% of revenue, floored at $2,500 — validated against three real organisations
 *  in validation/RESULTS.txt. Below this a grant is not worth an application. */
const MATERIALITY_FLOOR_RATE = 0.005;
```
