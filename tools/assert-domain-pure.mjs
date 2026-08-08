#!/usr/bin/env node
/**
 * packages/domain stays pure: no third-party runtime dependency, and exactly one workspace
 * import -- @merit/shared, which is itself dependency-free. See docs/decisions/0004.
 */
import { readFileSync } from 'node:fs';

const ALLOWED = new Set(['@merit/shared']);

const check = (path, allowed) => {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
  return declared.filter((name) => !allowed.has(name));
};

const failures = [
  ...check('packages/domain/package.json', ALLOWED).map((d) => `packages/domain depends on ${d}`),
  ...check('packages/shared/package.json', new Set()).map((d) => `packages/shared depends on ${d}`),
];

if (failures.length > 0) {
  console.error(`The pure layers must stay pure:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('domain and shared are dependency-free');
