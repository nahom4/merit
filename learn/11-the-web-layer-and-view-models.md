# 11 — The Web Layer: View-Models, Server Actions, and States That Explain Themselves

**TL;DR:** The same dependency rule, applied to React. Routes are thin, components take data rather than fetching it, and **all formatting lives in a pure view-model that is unit-tested** — so no JSX ever contains `toLocaleString`, a bucketing rule, or a conditional label. Loading, empty, and error states are designed with the success state, not retrofitted.

## The big picture

```
 app/organizations/[id]/page.tsx        ← route: parse input, call use case, render. ~20 lines
        │  calls
        ▼
 composition/container.ts               ← the only place an adapter is constructed
        │  returns
        ▼
 GetOrganization use case  ──►  Result<Organization, …>
        │
        ▼  toOrganizationProfileView()   ← features/*/view-model.ts — PURE, unit-tested
   OrganizationProfileView               all strings pre-formatted
        │
        ▼
 <OrganizationProfileCard profile={…} /> ← features/*/components — props in, JSX out
```

Writes go the other way through a server action:

```
 <form action={…}>  ──►  features/*/actions.ts  ──►  use case  ──►  redirect | error string
```

The folder layout follows the product surfaces, one per slice:

```
apps/web/src/
├── app/                    routes only
├── features/
│   ├── organization-profile/   components/ · view-model.ts · actions.ts
│   └── prospect-list/          view-model.ts
├── components/ui/          design-system primitives, no feature knowledge
└── composition/            container.ts
```

## The view-model is the interesting idea

```ts
// apps/web/src/features/organization-profile/view-model.ts:4-7
/**
 * What the profile screen needs, and nothing else. Formatting lives here rather than in JSX
 * so it can be unit-tested and so no component ever calls `toLocaleString` inline.
 */
```

A view-model is a **pure function from domain types to a flat record of display-ready strings**:

```ts
export interface OrganizationProfileView {
  readonly id: string;  readonly name: string;  readonly ein: string;
  readonly location: string;  readonly programArea: string;
  readonly annualRevenue: string;  readonly materialityFloor: string;  readonly region: string;
}
```

Every field is a `string`. No `Cents`, no `Ein`, no `Date`. The component's only job is placement.

What that buys:

- **Formatting becomes testable without rendering.** [`view-model.test.ts`](../apps/web/src/features/organization-profile/view-model.test.ts) is a plain unit test — no DOM, no React, no Playwright. It runs in the `unit` project with 90% coverage required.
- **The transformation is greppable.** "Why does this show $3,279?" has exactly one answer: `materialityFloor(organization.annualRevenue)` in the view-model.
- **Components stay trivially reviewable.** If a component contains a `?:` deciding a label, that logic belongs one file over.

Even small presentation decisions carry their reasoning:

```ts
// view-model.ts:35-37
// The organisation's own state first, then its neighbours alphabetically -- the reader
// is checking "is my state in here", not scanning an alphabetised list.
region: [state, ...[...Organization.region(organization)].filter((s) => s !== state).sort()].join(', '),
```

That is a *reader-task* argument, not an aesthetic one — the right way to justify a UI choice.

### The prospect-list view-model, where the product rules become code

[`prospect-list/view-model.ts`](../apps/web/src/features/prospect-list/view-model.ts) is worth reading in full, because three of the five product rules from `CLAUDE.md` land here.

**Four bars, never one number** — and each bar carries its own plain-English explanation:

```ts
// prospect-list/view-model.ts:45-56 (abridged)
/**
 * Four bars, never one number. A development director has to defend a prospect list to a
 * board, so each component says what it measures and every one is traceable to grantee rows.
 */
const barsFor = (prospect: Prospect) => [
  { label: 'Openness',  explanation: 'How much of this funder’s grantee list changes from year to year.', … },
  { label: 'Affinity',  explanation: 'How much of its giving goes to organisations like yours.', … },
  { label: 'Geography', explanation: 'How much of its giving stays in your state and the states around it.', … },
  { label: 'Size fit',  explanation: 'Whether its typical grant is the right size for an organisation your size.', … },
];
```

Note `ScoreBarView.percent` is `number | null`, and null renders as **"not enough filings"** rather than an empty bar. The unknown-is-not-zero discipline from [note 09](09-funder-signals-and-the-prospect-score.md) survives all the way to the pixel — which is the test of whether a null-handling policy is real.

**Coverage stated, never implied:**

```ts
// lines 113-118
// Coverage is stated, never implied. Silence would suggest the list is complete.
coverage: `${peersFound} comparable organisations found. ${candidateFundersConsidered} funders of those `
        + `organisations were examined, of which ${credibleFunders} are credible and material for you.`,
```

**An empty list explains itself** — and distinguishes three genuinely different empties:

```ts
// lines 125-145 (abridged)
/** An empty list explains itself. A blank panel is never acceptable. */
const emptyReasonFor = (listing: ProspectListing): string | null => {
  if (listing.prospects.length > 0) return null;
  if (peersFound === 0)
    return 'No comparable organisations were found in this program area and size band… This usually '
         + 'means the corpus has not been ingested yet, or the program code is unusual.';
  if (candidateFundersConsidered === 0)
    return `${peersFound} comparable organisations were found, but none of them has a funder on file…`;
  return `${candidateFundersConsidered} funders were examined, but none met the credibility bar: two or `
       + `more comparable grantees, or one in your region, with a median grant above ${money(floor)}.`;
};
```

"No peers exist", "peers exist but have no funders on file", and "funders exist but none is credible" are three different situations with three different user actions. Collapsing them into one "No results" is the failure this code exists to prevent — and notice the first message even names the likely *engineering* cause (corpus not ingested), because during S0–S1 that is the true answer.

## Routes are thin, and distinguish 404 from broken

```ts
// apps/web/src/app/organizations/[id]/page.tsx:8-22
export default async function OrganizationPage({ params }: { params: { id: string } }) {
  const result = await getOrganization().execute({ organizationId: params.id });

  if (!result.ok) {
    if (result.error.code === 'not_found') notFound();
    // A repository failure is not a 404. Say what happened rather than implying the
    // organisation does not exist.
    return <p role="alert" className="…">The database is unavailable, so this profile could not be
           loaded. Nothing was lost.</p>;
  }

  return <OrganizationProfileCard profile={toOrganizationProfileView(result.value)} />;
}
```

Twenty lines: call, branch on the `code`, transform, render. The distinction between "does not exist" and "we could not check" is exactly the kind of thing a `Result` with typed error codes makes easy and a thrown exception makes tedious. And *"Nothing was lost"* is written for a frightened user, not a log reader.

Server components are the default; `'use client'` requires a reason (interactivity or a browser API).

## Server actions map forms to use cases and nothing more

```ts
// apps/web/src/features/organization-profile/actions.ts:10-31 (abridged)
'use server';
/**
 * Maps a form submission to the use case. No logic here beyond that mapping: the parse
 * lives in the domain, the duplicate check lives in the use case.
 */
export async function submitOrganizationProfile(_previous, formData: FormData) {
  const result = await createOrganization().execute({
    name: formData.get('name'), ein: formData.get('ein'), …
  });
  if (!result.ok) return { error: messageFor(result.error.code, result.error.message) };
  redirect(`/organizations/${result.value.id}`);
}
```

`formData.get()` returns `FormDataEntryValue | null` — i.e. `unknown`-ish — and it is passed straight into `execute(input: unknown)`, which parses. **No hand-rolled validation in the action.** There is exactly one definition of "a valid organisation" in the system, and it lives in domain.

The error mapping turns codes into sentences a person can act on ([lines 33-38](../apps/web/src/features/organization-profile/actions.ts#L33-L38)) — *"The user sees what to change, not an error code."*

## The rule that protects the browser bundle

```js
// .eslintrc.cjs:101-118 — for apps/web/src/**/*.tsx
{ group: ['@merit/infrastructure', '@merit/infrastructure/*'],
  message: 'Components receive data as props. Adapters are constructed in composition/container.ts only.' }
```

*A client component that imports an adapter ships the database driver to the browser.* Not a style rule — a bundle-size and credential-exposure rule. `container.ts` additionally imports `'server-only'`, which makes the failure a build error rather than a runtime surprise.

## The non-negotiable UI rules

From [docs/architecture.md](../docs/architecture.md) §3 and [docs/conventions.md](../docs/conventions.md):

- Server components by default; `'use client'` needs a reason.
- **No data fetching in components.** A component that fetches is a component you cannot test.
- Formatting lives in the view-model. JSX contains no `toLocaleString`, no bucketing, no conditional label logic.
- **Every list has an explicit empty state that explains itself.**
- **Loading, error, and empty are designed at the same time as the success state**, not retrofitted.
- Tailwind, no inline styles. Repeated clusters become a primitive in `components/ui/`.
- Accessible by default: semantic elements, labelled controls, keyboard reachable, visible focus. Data tables are tables.
- Responsive by default.
- **Score components are never collapsed.**

The accessibility rule is load-bearing for testing too — the E2E spec locates fields with `getByLabel('EIN')` and `getByRole('button', { name: 'Save profile' })`. If a control loses its label, the test breaks. Accessibility and testability are the same property here.

## Why it mattered here

The product is a screen a fundraiser takes to a board. Numbers must be traceable, absences must be explained, and no claim may be stronger than the evidence. Pushing every formatting and labelling decision into a pure, unit-tested function is what makes those guarantees *checkable* rather than a matter of whoever wrote the JSX that afternoon.

## Applied in this project

- [`apps/web/src/features/organization-profile/view-model.ts`](../apps/web/src/features/organization-profile/view-model.ts) + [its test](../apps/web/src/features/organization-profile/view-model.test.ts)
- [`apps/web/src/features/prospect-list/view-model.ts`](../apps/web/src/features/prospect-list/view-model.ts) — four bars, coverage, three empty states
- [`apps/web/src/features/organization-profile/actions.ts`](../apps/web/src/features/organization-profile/actions.ts) — the server action
- [`apps/web/src/app/organizations/[id]/page.tsx`](../apps/web/src/app/organizations/%5Bid%5D/page.tsx) · [`not-found.tsx`](../apps/web/src/app/organizations/%5Bid%5D/not-found.tsx)
- [`apps/web/src/composition/container.ts`](../apps/web/src/composition/container.ts)

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Format inline in JSX | Untestable without rendering; the same money format drifts across five components |
| Fetch in client components (SWR/React Query) | Adapters would reach the browser; loses the server-component advantage; needs an API layer for no gain |
| Return domain types straight to components | Components would import domain and do the formatting — the problem moved, not solved |
| A generic `<EmptyState>` with one message | The three empty cases have different causes and different user actions |

**Cost:** one more file and one more type per surface, plus a mapping to maintain when a field is added. Accepted — the view-model *is* the screen's contract, and having it written down is a feature.

**Note on `prospect-list/view-model.ts`:** it currently has no colocated test and no components yet — it is groundwork for slice S1, ahead of the S0 boundary. Before S1 closes it needs a unit test to satisfy the 90% view-model coverage floor.

## Learn more

- [Next.js — Server Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js — Server Actions and Mutations](https://nextjs.org/docs/app/getting-started/updating-data)
- [MDN — `Intl.NumberFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat) — what `toLocaleString` is really doing
- [WAI — ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — the labelling the E2E locators depend on
