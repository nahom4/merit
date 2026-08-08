# 03 — Enforcing the Dependency Rule (and Testing the Enforcement)

**TL;DR:** Merit checks the layer rule four different ways, because each one has a hole the others cover — and then it *proves the checks work* by writing deliberate violations in CI, asserting they are rejected, and deleting them. A rule nobody checks is not a rule; an enforcement nobody tests is not an enforcement.

## The big picture

Four mechanisms, each catching what the previous one misses:

```
1. package.json graph      ── an undeclared dependency cannot resolve at all
2. eslint-plugin-boundaries ── catches it in your editor, as you type
3. dependency-cruiser       ── catches it in CI even if someone wrote eslint-disable
4. tools/prove-boundaries-fail.mjs ── proves 2 and 3 actually reject violations
   tools/assert-domain-pure.mjs    ── proves domain's package.json stays empty
```

All five run inside `pnpm gate`. Layer 4 is the unusual one and the most interesting.

## Mechanism 1 — the package graph

The cheapest enforcement is the one you get for free. `packages/domain/package.json` declares exactly one dependency (`@merit/shared`). An `import … from '@merit/infrastructure'` inside domain does not resolve, so it is not a lint warning — it is a type error and a build failure.

`tools/assert-domain-pure.mjs` keeps it that way:

```js
// tools/assert-domain-pure.mjs:8-22
const ALLOWED = new Set(['@merit/shared']);

const failures = [
  ...check('packages/domain/package.json', ALLOWED).map((d) => `packages/domain depends on ${d}`),
  ...check('packages/shared/package.json', new Set()).map((d) => `packages/shared depends on ${d}`),
];
```

Note it checks `shared` against an **empty** set. `shared` is the base of the graph; if it grows a dependency, the whole purity argument collapses.

## Mechanism 2 — ESLint boundaries (fast feedback)

`eslint-plugin-boundaries` labels every file by path, then declares which labels may import which:

```js
// .eslintrc.cjs:46-60
'boundaries/element-types': ['error', {
  default: 'disallow',                                    // ← deny by default
  rules: [
    { from: 'shared',         allow: ['shared'] },
    { from: 'domain',         allow: ['domain', 'shared'] },
    { from: 'application',    allow: ['application', 'domain', 'shared'] },
    { from: 'infrastructure', allow: ['infrastructure', 'application', 'domain', 'shared'] },
    { from: 'app',            allow: ['app', 'infrastructure', 'application', 'domain', 'shared'] },
    …
  ],
}],
```

`default: 'disallow'` is the load-bearing word. A new element type added later is forbidden until someone explicitly permits it — the safe direction to fail.

ESLint also enforces the rules the package graph *cannot* see, because they are about language features rather than imports:

```js
// .eslintrc.cjs:64-78 — inside packages/domain only
'no-restricted-imports': ['error', { patterns: ['zod', '@libsql/*', 'node:*', …] }],
'no-restricted-properties': ['error',
  { object: 'Date',  property: 'now',    message: 'Time is an injected Clock port.' },
  { object: 'Math',  property: 'random', message: 'Randomness is an injected port.' },
],
```

That is the "no hidden clocks or randomness" rule from `CLAUDE.md`, made mechanical. And globally, [`.eslintrc.cjs:41-44`](../.eslintrc.cjs#L41-L44) bans the `fetch` global everywhere with the message *"Network access belongs in packages/infrastructure."*

The React-specific one is worth calling out — [`.eslintrc.cjs:101-118`](../.eslintrc.cjs#L101-L118) forbids any `.tsx` file from importing `@merit/infrastructure`, because **a client component that imports an adapter ships the database driver to the browser.**

## Mechanism 3 — dependency-cruiser (CI, unbypassable)

Why both? The config file says it plainly:

```js
// .dependency-cruiser.cjs:1-7
/**
 * The dependency rule, mechanised: domain <- application <- infrastructure <- apps.
 *
 * ESLint `boundaries` catches this while you type; this catches it in CI even when
 * someone disables the ESLint rule inline. Both are load-bearing on purpose.
 */
```

An `// eslint-disable-next-line` defeats mechanism 2 and nothing else. dependency-cruiser reads the module graph directly.

Two subtleties in that config are the kind of thing that costs an afternoon if you meet them cold:

```js
// .dependency-cruiser.cjs:24-27
// Workspace packages resolve to their bare specifier (pnpm symlinks node_modules and
// `doNotFollow` stops there), so both spellings are listed. Matching only the file path
// would let `import ... from "@merit/infrastructure"` through unseen.
to: { path: '^packages/infrastructure/src|^apps/|^@merit/(infrastructure|web|worker)$' },
```

```js
// .dependency-cruiser.cjs:68-70
// Ports are imported as types only. Without this the graph cannot see them and reports
// every interface in the application layer as an orphan.
tsPreCompilationDeps: true,
```

That second one generalises: **type-only imports are invisible to a post-compilation module graph.** In a ports-and-adapters codebase, that is most of your interesting edges.

## Mechanism 4 — proving the enforcement works

This is the part most codebases skip, and it is the best idea in the repo.

Slice S0's acceptance criteria required *"a deliberately broken commit proving they fail"*. Rather than leave a broken commit in history for future contributors to trip over, `tools/prove-boundaries-fail.mjs` does it every CI run:

```js
// tools/prove-boundaries-fail.mjs:63-85 (abridged)
for (const testCase of CASES) {
  writeFileSync(testCase.file, testCase.source);        // write a real violation
  try {
    const eslintRejected  = fails('npx', ['eslint', testCase.file, '--max-warnings', '0']);
    const cruiserRejected = fails('npx', ['depcruise', 'packages', 'apps', '--config', …]);
    allProven &&= eslintRejected || cruiserRejected;    // at least one must reject it
  } finally {
    rmSync(testCase.file, { force: true });             // and always clean up
  }
}
```

The four cases it writes are real violations of real rules: domain importing infrastructure, application importing infrastructure, infrastructure importing an app (via a relative path — *the way it happens in practice*), and domain importing zod.

If a violation is ever accepted, the script fails with: *"A layer violation was accepted. The dependency rule is not being enforced."*

**Why this matters:** a misconfigured linter is silent. It reports success on every commit, forever, while enforcing nothing. This is the only class of bug where "no errors" and "not running" look identical from the outside — so it needs a test that asserts the *negative* case.

The same reasoning drives `tools/no-skipped-tests.mjs`, which greps for `.skip`, `.only`, `xit`, `fdescribe`. A quarantined flaky test is a disabled test with extra steps, and a suite that passes because half of it is skipped looks exactly like a healthy one.

## Why it mattered here

Merit is built by one developer plus agents, under time pressure, across two runtimes and ~7,000 lines that will grow toward a 2M-record corpus. The layering is the only thing keeping domain logic unit-testable at 100% coverage and keeping the worker from transitively importing React. Discipline does not scale; machines do.

## Applied in this project

- [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs) — the graph rules, plus `no-circular`
- [`.eslintrc.cjs`](../.eslintrc.cjs) — boundaries, per-layer import bans, no-`fetch`, no-`Date.now`
- [`tools/prove-boundaries-fail.mjs`](../tools/prove-boundaries-fail.mjs) — the enforcement's own test
- [`tools/assert-domain-pure.mjs`](../tools/assert-domain-pure.mjs) — domain/shared package.json purity
- [`tools/no-skipped-tests.mjs`](../tools/no-skipped-tests.mjs) — no `.skip` / `.only`
- [`package.json:33`](../package.json#L33) — `gate` runs all of them, in order

## Trade-offs / alternatives

**Two overlapping linters is redundancy, not waste.** They fail differently: ESLint is per-file and bypassable inline; dependency-cruiser is whole-graph and configuration-level. Merit accepts running both.

**Cost of `prove-boundaries-fail`:** it shells out to `npx eslint` and `npx depcruise` four times, so it is one of the slower gate steps. Accepted, because the failure it catches is silent and permanent.

**A known softness**, honestly stated in the script itself ([lines 47-48](../tools/prove-boundaries-fail.mjs#L47-L48)): for the "domain importing zod" case, dependency-cruiser's rule is incidental and ESLint is the primary guard. The script requires only that *at least one* mechanism rejects each case, not both.

## Learn more

- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)
- [ESLint — no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports)
- [ADR-0001](../docs/decisions/0001-layers-as-workspace-packages.md) — the decision these mechanisms defend
