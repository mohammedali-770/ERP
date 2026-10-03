import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleEdgeDependencyMap, ruleEdgeLockfile, ruleEdgeImports, ruleEdgeHasOneConfig, specifiers,
  type DenoConfig, type DenoLock,
} from '../src/deno.ts';

const CONFIG: DenoConfig = { imports: { postgres: 'npm:postgres@3.4.9' }, nodeModulesDir: 'none', lock: true };
const LOCK: DenoLock = {
  version: '5',
  specifiers: { 'npm:postgres@3.4.9': '3.4.9' },
  npm: { 'postgres@3.4.9': { integrity: 'sha512-GD3qdB0x1z9xgFI6cdRD6xu2Sp2WCOEoe3mtnyB5Ee0XrrL5Pe+e4CCnJrRMnL1zYtRDZmQQVbvOttLnKDLnaw==' } },
  workspace: { dependencies: ['npm:postgres@3.4.9'] },
};

const messages = (findings: ReadonlyArray<{ message: string }>) => findings.map((f) => f.message);

// --- the map ---------------------------------------------------------------

test('the committed shape passes', () => {
  assert.deepEqual(ruleEdgeDependencyMap(CONFIG), []);
  assert.deepEqual(ruleEdgeLockfile(CONFIG, LOCK), []);
});

test('CONTROL: a range instead of an exact version is a finding', () => {
  for (const target of ['npm:postgres@^3.4.9', 'npm:postgres@3', 'npm:postgres', 'npm:postgres@latest',
    'https://deno.land/x/postgresjs@v3.4.9/mod.js', 'npm:pg@8.0.0']) {
    const findings = ruleEdgeDependencyMap({ ...CONFIG, imports: { postgres: target } });
    assert.equal(findings.length, 1, target);
    assert.match(findings[0]!.message, /not an exact npm:postgres@x\.y\.z/);
  }
});

test('a second dependency, or a missing one, is a finding', () => {
  assert.match(messages(ruleEdgeDependencyMap({ ...CONFIG, imports: { postgres: 'npm:postgres@3.4.9', zod: 'npm:zod@3.23.8' } })).join(),
    /maps "zod", which is not a permitted edge dependency/);
  assert.match(messages(ruleEdgeDependencyMap({ ...CONFIG, imports: {} })).join(), /does not map "postgres"/);
});

test('keys that can add or redirect a dependency are findings', () => {
  for (const key of ['scopes', 'importMap', 'workspace', 'links', 'unstable']) {
    assert.match(messages(ruleEdgeDependencyMap({ ...CONFIG, [key]: {} })).join(), new RegExp(`sets "${key}"`), key);
  }
  assert.match(messages(ruleEdgeDependencyMap({ ...CONFIG, lock: false })).join(), /turns the lockfile off/);
  assert.match(messages(ruleEdgeDependencyMap({ ...CONFIG, nodeModulesDir: 'auto' })).join(), /nodeModulesDir/);
  assert.match(messages(ruleEdgeDependencyMap(null)).join(), /deno\.json is missing/);
});

// --- the lock --------------------------------------------------------------

test('CONTROL: a transitive package arriving in the lock is a finding', () => {
  const lock: DenoLock = { ...LOCK, npm: { ...LOCK.npm, 'pg-protocol@1.0.0': { integrity: 'sha512-x' } } };
  assert.match(messages(ruleEdgeLockfile(CONFIG, lock)).join(), /holds pg-protocol@1\.0\.0, which is not a pinned/);
});

test('a lock that disagrees with the map, or lacks a hash, is a finding', () => {
  const stale: DenoLock = {
    specifiers: { 'npm:postgres@3.4.8': '3.4.8' },
    npm: { 'postgres@3.4.8': { integrity: 'sha512-x' } },
  };
  const found = messages(ruleEdgeLockfile(CONFIG, stale)).join('\n');
  assert.match(found, /resolves npm:postgres@3\.4\.8 to 3\.4\.8, which deno\.json does not pin/);
  assert.match(found, /does not record npm:postgres@3\.4\.9/);
  assert.match(found, /does not lock postgres@3\.4\.9/);

  const unhashed: DenoLock = { ...LOCK, npm: { 'postgres@3.4.9': {} } };
  assert.match(messages(ruleEdgeLockfile(CONFIG, unhashed)).join(), /no sha512 integrity/);
  assert.match(messages(ruleEdgeLockfile(CONFIG, null)).join(), /deno\.lock is missing/);
});

test('a JSR module or a remote URL in the lock is a finding', () => {
  assert.match(messages(ruleEdgeLockfile(CONFIG, { ...LOCK, jsr: { '@std/assert@1.0.0': {} } })).join(), /jsr entries/);
  assert.match(messages(ruleEdgeLockfile(CONFIG, { ...LOCK, remote: { 'https://deno.land/x/a.ts': 'h' } })).join(), /remote entries/);
  assert.deepEqual(ruleEdgeLockfile(CONFIG, { ...LOCK, remote: {} }), [], 'an empty section is no dependency');
});

// --- the imports -----------------------------------------------------------

test('specifiers are read from every import form', () => {
  const source = [
    "import postgres from 'postgres';",
    "import type { Db } from './db.ts';",
    "import {\n  a,\n  b,\n} from \"../x.ts\";",
    "export { c } from './c.ts';",
    "import './side-effect.ts';",
    "const m = await import('npm:left-pad@1.0.0');",
  ].join('\n');
  assert.deepEqual(specifiers(source).sort(),
    ['../x.ts', './c.ts', './db.ts', './side-effect.ts', 'npm:left-pad@1.0.0', 'postgres'].sort());
});

test('the committed layout passes', () => {
  assert.deepEqual(ruleEdgeImports([
    { path: 'supabase/functions/_deno/db.ts', source: "import postgres from 'postgres';\nimport { asSignInAnswer } from '../_shared/db.ts';" },
    { path: 'supabase/functions/sign-in/index.ts', source: "import { serve } from '../_deno/serve.ts';" },
    { path: 'supabase/functions/_shared/handlers.ts', source: "import type { Db } from './db.ts';" },
    { path: 'supabase/functions/_shared/test/handlers.test.ts', source: "import { test } from 'node:test';\nimport { signIn } from '../handlers.ts';" },
  ]), []);
});

test('CONTROL: the driver imported outside _deno/ is a finding', () => {
  const found = ruleEdgeImports([{ path: 'supabase/functions/_shared/db.ts', source: "import postgres from 'postgres';" }]);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /only _deno\/ may/);
});

test('_shared/ reaching into _deno/, or anything leaving supabase/functions, is a finding', () => {
  assert.match(messages(ruleEdgeImports([
    { path: 'supabase/functions/_shared/http.ts', source: "import { connect } from '../_deno/db.ts';" },
  ])).join(), /outside _shared\//);
  assert.match(messages(ruleEdgeImports([
    { path: 'supabase/functions/sign-in/index.ts', source: "import { x } from '../../../packages/contracts/src/index.ts';" },
  ])).join(), /outside supabase\/functions/);
});

test('any other specifier is an unpinned dependency', () => {
  for (const specifier of ['npm:postgres@3.4.9', 'jsr:@std/assert', 'https://esm.sh/zod', 'node:crypto', 'zod']) {
    const found = ruleEdgeImports([{ path: 'supabase/functions/_deno/db.ts', source: `import x from '${specifier}';` }]);
    assert.equal(found.length, 1, specifier);
  }
  // node: builtins are for Node's tests only, which nothing deployed reaches.
  assert.equal(ruleEdgeImports([{ path: 'supabase/functions/_shared/http.ts', source: "import { test } from 'node:test';" }]).length, 1);
  assert.equal(ruleEdgeImports([{ path: 'supabase/functions/_shared/test/a.test.ts', source: "import { readFileSync } from 'node:fs';" }]).length, 1);
});

// --- one config ------------------------------------------------------------

test('a second manifest under supabase/ is a finding', () => {
  assert.deepEqual(ruleEdgeHasOneConfig([
    'supabase/functions/deno.json', 'supabase/functions/deno.lock', 'supabase/functions/sign-in/index.ts', 'package.json',
  ]), []);
  for (const file of ['supabase/functions/sign-in/deno.json', 'supabase/functions/import_map.json',
    'supabase/functions/session/deno.jsonc', 'supabase/package.json', 'supabase/functions/sign-out/deno.lock']) {
    assert.equal(ruleEdgeHasOneConfig([file]).length, 1, file);
  }
});
