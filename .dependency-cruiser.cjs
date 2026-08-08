/**
 * The dependency rule, mechanised: domain <- application <- infrastructure <- apps.
 *
 * ESLint `boundaries` catches this while you type; this catches it in CI even when
 * someone disables the ESLint rule inline. Both are load-bearing on purpose --
 * see docs/architecture.md section 4.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-imports-only-shared',
      severity: 'error',
      comment:
        'packages/domain is pure. Its only permitted import is @merit/shared, which is itself ' +
        'dependency-free -- see docs/decisions/0004-domain-may-import-shared.md.',
      from: { path: '^packages/domain/src' },
      to: { pathNot: ['^packages/domain/src', '^packages/shared/src', '^@merit/shared$'] },
    },
    {
      name: 'application-only-domain',
      severity: 'error',
      comment: 'packages/application may depend on domain and shared, never outward.',
      from: { path: '^packages/application/src' },
      // Workspace packages resolve to their bare specifier (pnpm symlinks node_modules and
      // `doNotFollow` stops there), so both spellings are listed. Matching only the file path
      // would let `import ... from "@merit/infrastructure"` through unseen.
      to: { path: '^packages/infrastructure/src|^apps/|^@merit/(infrastructure|web|worker)$' },
    },
    {
      name: 'infrastructure-never-apps',
      severity: 'error',
      comment: 'Adapters may not reach into a composition root.',
      from: { path: '^packages/infrastructure/src' },
      to: { path: '^apps/|^@merit/(web|worker)$' },
    },
    {
      name: 'shared-depends-on-nothing',
      severity: 'error',
      comment: 'packages/shared is the base of the graph.',
      from: { path: '^packages/shared/src' },
      to: { path: '^packages/(domain|application|infrastructure)/src|^apps/|^@merit/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '\\.config\\.(js|cjs|mjs|ts)$',
          // Next.js discovers these by filename; nothing imports them.
          'apps/web/src/app/.*/(page|layout|not-found|loading|error)\\.tsx$',
          'apps/web/src/app/(page|layout)\\.tsx$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.test\\.tsx?$|/dist/|/\\.next/|/node_modules/)' },
    // Ports are imported as types only. Without this the graph cannot see them and reports
    // every interface in the application layer as an orphan.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
