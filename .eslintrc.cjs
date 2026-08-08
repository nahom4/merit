/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'boundaries', 'unicorn'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: [
    'node_modules',
    'dist',
    '.next',
    'coverage',
    'validation',
    'tools',
    'submission_docs',
    '*.cjs',
    '*.mjs',
  ],
  settings: {
    'boundaries/elements': [
      { type: 'shared', pattern: 'packages/shared/src/**' },
      { type: 'domain', pattern: 'packages/domain/src/**' },
      { type: 'application', pattern: 'packages/application/src/**' },
      { type: 'infrastructure', pattern: 'packages/infrastructure/src/**' },
      { type: 'app', pattern: 'apps/*/src/**' },
      { type: 'test', pattern: 'tests/**' },
      { type: 'eval', pattern: 'evals/**' },
    ],
    'boundaries/include': [
      'packages/**/*.ts',
      'apps/**/*.ts',
      'apps/**/*.tsx',
      'tests/**/*.ts',
      'evals/**/*.ts',
    ],
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'Network access belongs in packages/infrastructure.' },
    ],
    'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          { from: 'shared', allow: ['shared'] },
          { from: 'domain', allow: ['domain', 'shared'] },
          { from: 'application', allow: ['application', 'domain', 'shared'] },
          { from: 'infrastructure', allow: ['infrastructure', 'application', 'domain', 'shared'] },
          { from: 'app', allow: ['app', 'infrastructure', 'application', 'domain', 'shared'] },
          { from: 'test', allow: ['test', 'app', 'infrastructure', 'application', 'domain', 'shared'] },
          { from: 'eval', allow: ['eval', 'infrastructure', 'application', 'domain', 'shared'] },
        ],
      },
    ],
  },
  overrides: [
    {
      // Domain is pure: no I/O, no clocks, no randomness, not even Zod.
      files: ['packages/domain/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: ['zod', '@libsql/*', 'node:*', '@merit/application', '@merit/infrastructure'],
          },
        ],
        'no-restricted-properties': [
          'error',
          { object: 'Date', property: 'now', message: 'Time is an injected Clock port.' },
          { object: 'Math', property: 'random', message: 'Randomness is an injected port.' },
        ],
      },
    },
    {
      // Application orchestrates. It must not know about SQL, HTTP, or React.
      files: ['packages/application/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: ['@libsql/*', 'react', 'next/*', '@merit/infrastructure', '**/apps/**'] },
        ],
      },
    },
    {
      // Adapters translate. Reaching into a composition root inverts the graph, and a
      // relative path is the way it happens in practice.
      //
      // `fetch` is permitted here and only here: this is the layer whose whole job is I/O.
      files: ['packages/infrastructure/src/**/*.ts'],
      rules: {
        'no-restricted-globals': 'off',
        'no-restricted-imports': ['error', { patterns: ['@merit/web', '@merit/worker', '**/apps/**'] }],
      },
    },
    {
      // Integration and contract tests make real network calls by design -- that is the
      // point of those tiers.
      files: ['tests/**/*.ts', 'evals/**/*.ts'],
      rules: { 'no-restricted-globals': 'off' },
    },
    {
      // A client component that imports an adapter ships the database driver to the browser.
      files: ['apps/web/src/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@merit/infrastructure', '@merit/infrastructure/*'],
                message:
                  'Components receive data as props. Adapters are constructed in composition/container.ts only.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts', 'evals/**/*.ts'],
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  ],
};
