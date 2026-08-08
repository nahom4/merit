#!/usr/bin/env node
/**
 * A rule nobody checks is not a rule -- and an enforcement nobody tests is not an enforcement.
 *
 * S0 requires proof that the layer checks actually fail on an inward-pointing violation.
 * Rather than leaving a deliberately broken commit in the history for future contributors to
 * trip over, this writes the violation, asserts both ESLint and dependency-cruiser reject it,
 * and removes it again. It runs in CI on every PR.
 *
 * Each case is a real violation of the rule named in docs/architecture.md section 2.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

const CASES = [
  {
    name: 'domain importing infrastructure',
    file: 'packages/domain/src/organization/violation.ts',
    source: [
      "import { createDatabase } from '@merit/infrastructure';",
      'export const leak = createDatabase;',
      '',
    ].join('\n'),
  },
  {
    name: 'application importing infrastructure',
    file: 'packages/application/src/violation.ts',
    source: [
      "import { LibsqlOrganizationRepository } from '@merit/infrastructure';",
      'export const leak = LibsqlOrganizationRepository;',
      '',
    ].join('\n'),
  },
  {
    name: 'infrastructure importing an app',
    file: 'packages/infrastructure/src/violation.ts',
    source: [
      "import { organizationRepository } from '../../../apps/web/src/composition/container.js';",
      'export const leak = organizationRepository;',
      '',
    ].join('\n'),
  },
  {
    name: 'domain importing zod',
    file: 'packages/domain/src/violation.ts',
    source: ["import { z } from 'zod';", 'export const leak = z.string();', ''].join('\n'),
    // dependency-cruiser's domain rule permits only domain and shared paths, and node_modules
    // resolution of zod lands outside both -- but ESLint is the primary guard here.
  },
];

const fails = (command, args) => {
  try {
    execFileSync(command, args, { stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
};

let allProven = true;

for (const testCase of CASES) {
  writeFileSync(testCase.file, testCase.source);
  try {
    const eslintRejected = fails('npx', ['eslint', testCase.file, '--max-warnings', '0']);
    const cruiserRejected = fails('npx', [
      'depcruise',
      'packages',
      'apps',
      '--config',
      '.dependency-cruiser.cjs',
    ]);

    const proven = eslintRejected || cruiserRejected;
    allProven &&= proven;
    console.log(
      `${proven ? 'PASS' : 'FAIL'}  ${testCase.name}` +
        `  (eslint: ${eslintRejected ? 'rejected' : 'ALLOWED'},` +
        ` dependency-cruiser: ${cruiserRejected ? 'rejected' : 'ALLOWED'})`,
    );
  } finally {
    rmSync(testCase.file, { force: true });
  }
}

if (!allProven) {
  console.error('\nA layer violation was accepted. The dependency rule is not being enforced.');
  process.exit(1);
}
console.log('\nEvery layer violation was rejected by at least one check.');
