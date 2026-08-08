#!/usr/bin/env node
/**
 * CI fails on `.skip` and `.only`. A test that cannot pass gets deleted or fixed --
 * a quarantined test is a disabled test with extra steps (docs/testing.md rule 7).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['packages', 'apps', 'tests', 'evals'];
const IGNORED = new Set(['node_modules', 'dist', '.next', 'coverage']);
const OFFENDING = /\b(describe|it|test)\.(skip|only)\b|\b(xit|xdescribe|fdescribe|fit)\s*\(/;

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(full)) continue;
    if (full.endsWith('no-skipped-tests.mjs')) continue;
    readFileSync(full, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (OFFENDING.test(line)) offenders.push(`${relative(process.cwd(), full)}:${i + 1}  ${line.trim()}`);
      });
  }
}

for (const root of ROOTS) {
  try {
    walk(root);
  } catch {
    // A root that does not exist yet is not an error.
  }
}

if (offenders.length > 0) {
  console.error('Skipped or focused tests are not allowed:\n' + offenders.map((o) => `  ${o}`).join('\n'));
  process.exit(1);
}
console.log('no skipped or focused tests');
