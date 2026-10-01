import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleNoEmittedArtifactCommitted, ruleDeclaredDependencies, ruleLockfileMatchesManifests,
  ruleToolingClosureIsPinned, ruleNoBuildStepOutsideApps, ruleEveryWorkspaceIsTypechecked,
  TOOLING_CLOSURE,
  type Manifest, type Lockfile, type LockEntry, type Finding,
} from '../src/rules.ts';

const ROOT: Manifest = {
  workspace: '.',
  devDependencies: { '@types/node': '^22.10.2', typescript: '^5.7.2' },
  scripts: { build: 'tsc --noEmit', typecheck: 'tsc --noEmit' },
};
const TOOL: Manifest = { workspace: 'tools/req-lint', name: '@firsttaste/req-lint' };
const APP: Manifest = { workspace: 'apps/console', name: '@firsttaste/app-console' };

const TSCONFIG = { compilerOptions: { noEmit: true } };

function lock(packages: Record<string, unknown>): Lockfile {
  // Cast to the non-optional shape: `Lockfile['packages']` includes `undefined`,
  // which exactOptionalPropertyTypes refuses to assign to an optional property.
  return { lockfileVersion: 3, packages: packages as Readonly<Record<string, LockEntry>> };
}

// --- no-emitted-artifact-committed ------------------------------------------

test('emitted artifacts tracked outside apps are findings', () => {
  // The sixteen that were actually committed, in tools/prd-extract/src/.
  const findings = ruleNoEmittedArtifactCommitted([
    'tools/prd-extract/src/extract.ts',
    'tools/prd-extract/src/extract.js',
    'tools/prd-extract/src/extract.js.map',
    'tools/prd-extract/src/extract.d.ts',
    'tools/prd-extract/src/extract.d.ts.map',
  ]);
  assert.equal(findings.length, 4);
  assert.ok(findings.every((f) => f.rule === 'no-emitted-artifact-committed'));
  assert.match(findings[0]!.remedy, /runs the TypeScript source directly/);
});

test('emitted artifacts under apps are permitted', () => {
  // ADR-0021 §4: apps may have a build step. Its output is not this rule's business.
  assert.deepEqual(ruleNoEmittedArtifactCommitted(['apps/console/dist/index.js']), []);
});

test('a .ts source is never mistaken for emit', () => {
  // `.d.ts` ends with `.ts`; an over-broad pattern would flag every source file.
  assert.deepEqual(ruleNoEmittedArtifactCommitted(['tools/x/src/a.ts', 'docs/README.md']), []);
});

// --- declared-dependencies --------------------------------------------------

test('the permitted root dependencies pass', () => {
  assert.deepEqual(ruleDeclaredDependencies([ROOT, TOOL]), []);
});

test('a third root dependency is a finding', () => {
  const findings = ruleDeclaredDependencies([
    { ...ROOT, devDependencies: { ...ROOT.devDependencies, zod: '^3' } },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /zod/);
  assert.match(findings[0]!.remedy, /needs an ADR/);
});

test('a runtime dependency at the root is a finding of its own', () => {
  const findings = ruleDeclaredDependencies([{ ...ROOT, dependencies: { express: '^4' } }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /runtime dependencies/);
});

test('a dependency in a tool is a finding', () => {
  const findings = ruleDeclaredDependencies([ROOT, { ...TOOL, dependencies: { chalk: '^5' } }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /tools\/req-lint declares dependencies/);
});

test('every dependency kind is checked, not just dependencies', () => {
  const findings = ruleDeclaredDependencies([
    ROOT,
    { ...TOOL, peerDependencies: { react: '^18' }, optionalDependencies: { fsevents: '^2' } },
  ]);
  assert.equal(findings.length, 2);
});

test('dependencies in an app are permitted', () => {
  assert.deepEqual(
    ruleDeclaredDependencies([ROOT, { ...APP, dependencies: { react: '^18.3.1' } }]),
    [],
  );
});

// --- lockfile-matches-manifests ---------------------------------------------

const CLEAN_LOCK = lock({
  '': { name: '@firsttaste/erp', devDependencies: { '@types/node': '^22.10.2', typescript: '^5.7.2' } },
  'tools/req-lint': { name: '@firsttaste/req-lint', version: '0.0.0' },
  'node_modules/@firsttaste/req-lint': { resolved: 'tools/req-lint', link: true },
});

test('a lockfile that agrees with the manifests passes', () => {
  assert.deepEqual(
    ruleLockfileMatchesManifests(CLEAN_LOCK, [ROOT, TOOL], ['tools/req-lint']),
    [],
  );
});

test('a workspace missing from the lockfile is a finding', () => {
  // This is what a dependency added without `npm install` looks like, and without
  // it the declared-dependencies assertion would pass over an absent entry.
  const findings = ruleLockfileMatchesManifests(CLEAN_LOCK, [ROOT, TOOL], ['tools/req-lint', 'tools/new']);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /tools\/new is a workspace on disk with no lockfile entry/);
});

test('a lockfile recording dependencies for a non-app workspace is a finding', () => {
  const l = lock({ ...CLEAN_LOCK.packages, 'tools/req-lint': { dependencies: { chalk: '^5' } } });
  const findings = ruleLockfileMatchesManifests(l, [ROOT, TOOL], ['tools/req-lint']);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /records dependencies for tools\/req-lint/);
});

test('a link pointing at a directory that is gone is a finding', () => {
  const l = lock({ ...CLEAN_LOCK.packages, 'node_modules/@firsttaste/x': { resolved: 'tools/gone', link: true } });
  const findings = ruleLockfileMatchesManifests(l, [ROOT, TOOL], ['tools/req-lint']);
  assert.ok(findings.some((f) => /links to tools\/gone/.test(f.message)));
});

test('root devDependencies drifting from the lockfile is a finding', () => {
  const l = lock({ ...CLEAN_LOCK.packages, '': { devDependencies: { typescript: '^5.7.2' } } });
  const findings = ruleLockfileMatchesManifests(l, [ROOT, TOOL], ['tools/req-lint']);
  assert.ok(findings.some((f) => /root devDependencies differ/.test(f.message)));
});

test('a v2 lockfile is rejected rather than half-read', () => {
  const findings = ruleLockfileMatchesManifests({ lockfileVersion: 2, packages: {} }, [ROOT], []);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /lockfileVersion is 2/);
});

// --- tooling-closure-is-pinned ----------------------------------------------

test('the pinned closure passes', () => {
  const l = lock({
    'node_modules/typescript': { dev: true },
    'node_modules/@types/node': { dev: true, dependencies: { 'undici-types': '~6.21.0' } },
    'node_modules/undici-types': { dev: true },
  });
  assert.deepEqual(ruleToolingClosureIsPinned(l, [ROOT]), []);
});

test('an unpinned package nobody can account for is a finding', () => {
  const l = lock({ 'node_modules/typescript': { dev: true }, 'node_modules/left-pad': { dev: true } });
  const findings = ruleToolingClosureIsPinned(l, [ROOT]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /left-pad is installed/);
  assert.match(findings[0]!.remedy, /think hard about/);
});

test("an app's transitive closure is excluded by provenance, however large", () => {
  // The design point: apps/console declaring react pulls in packages this checker
  // must not police, and an allowlist would have to grow forever to keep up.
  const l = lock({
    'node_modules/react': { dependencies: { 'loose-envify': '^1' } },
    'node_modules/loose-envify': { dependencies: { 'js-tokens': '^4' } },
    'node_modules/js-tokens': {},
    'node_modules/typescript': { dev: true },
  });
  const app: Manifest = { ...APP, dependencies: { react: '^18.3.1' } };
  assert.deepEqual(ruleToolingClosureIsPinned(l, [ROOT, app]), []);
});

test('a package reachable only from a tool is still a finding', () => {
  // Reachability is from apps ONLY. A tool cannot launder a dependency.
  const l = lock({ 'node_modules/chalk': { dev: true }, 'node_modules/typescript': { dev: true } });
  const findings = ruleToolingClosureIsPinned(l, [ROOT, { ...TOOL, dependencies: { chalk: '^5' } }]);
  assert.ok(findings.some((f) => /chalk is installed/.test(f.message)));
});

test('a tooling package that is not dev-only is a finding', () => {
  const l = lock({ 'node_modules/typescript': { dev: false } });
  const findings = ruleToolingClosureIsPinned(l, [ROOT]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /not marked dev/);
});

// --- no-build-step-outside-apps ---------------------------------------------

test('the repository as it stands passes', () => {
  assert.deepEqual(ruleNoBuildStepOutsideApps([ROOT, TOOL], TSCONFIG), []);
});

test('a postinstall hook anywhere is a finding', () => {
  // supabase/README.md:39-42 gives this as the reason the Supabase CLI is not an
  // npm dependency. It was a stated rule with nothing enforcing it.
  const findings = ruleNoBuildStepOutsideApps(
    [ROOT, { ...TOOL, scripts: { postinstall: 'curl … | sh' } }],
    TSCONFIG,
  );
  assert.ok(findings.some((f) => /declares a postinstall script/.test(f.message)));
});

test('a root build script that actually emits is a finding', () => {
  const findings = ruleNoBuildStepOutsideApps(
    [{ ...ROOT, scripts: { build: 'tsc' } }],
    TSCONFIG,
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /root build script is "tsc"/);
});

test('a bundler in a root script is a finding', () => {
  const findings = ruleNoBuildStepOutsideApps(
    [{ ...ROOT, scripts: { ...ROOT.scripts, bundle: 'esbuild src --bundle' } }],
    TSCONFIG,
  );
  assert.ok(findings.some((f) => /invokes a bundler/.test(f.message)));
});

test('an app may declare whatever scripts it likes', () => {
  assert.deepEqual(
    ruleNoBuildStepOutsideApps(
      [ROOT, { ...APP, scripts: { build: 'vite build', dev: 'vite' } }],
      TSCONFIG,
    ),
    [],
  );
});

test('losing noEmit is a finding', () => {
  const findings = ruleNoBuildStepOutsideApps([ROOT], { compilerOptions: {} });
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /does not set noEmit/);
});

test('project references are a finding', () => {
  const findings = ruleNoBuildStepOutsideApps([ROOT], { ...TSCONFIG, references: [] });
  assert.ok(findings.some((f) => /project references/.test(f.message)));
});

// --- every-workspace-is-typechecked -----------------------------------------

test('a workspace covered by the root tsconfig passes', () => {
  assert.deepEqual(
    ruleEveryWorkspaceIsTypechecked(['tools/req-lint'], ['tools/*/src/**/*.ts'], 'tsc --noEmit'),
    [],
  );
});

test('a workspace covered only by its own tsc project passes', () => {
  // The apps/console case once it carries its own tsconfig.
  assert.deepEqual(
    ruleEveryWorkspaceIsTypechecked(['apps/console'], [], 'tsc --noEmit && tsc --noEmit -p apps/console'),
    [],
  );
});

test('a workspace covered by neither is a finding', () => {
  const findings = ruleEveryWorkspaceIsTypechecked(['apps/console'], ['tools/*/src/**/*.ts'], 'tsc --noEmit');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /apps\/console is in no tsconfig include/);
});

/**
 * The coarse version of this rule did not fire for the case it was written for.
 * `apps/console`'s .ts files ARE covered by the root include `apps/*\/src/**\/*.ts`,
 * so the workspace looked covered while its .tsx files were seen by no tsc at all —
 * TypeScript matches an explicit `.ts` glob literally. Found by running the control
 * and watching nothing happen.
 */
test('a workspace with JSX and no project of its own is a finding, even when the root covers its .ts', () => {
  const findings = ruleEveryWorkspaceIsTypechecked(
    ['apps/console'], ['apps/*/src/**/*.ts'], 'tsc --noEmit', ['apps/console'],
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /contains JSX/);
  assert.match(findings[0]!.remedy, /tsc --noEmit -p apps\/console/);
});

test('a workspace with JSX and its own project passes', () => {
  assert.deepEqual(
    ruleEveryWorkspaceIsTypechecked(
      ['apps/console'], ['apps/*/src/**/*.ts'], 'tsc --noEmit && tsc --noEmit -p apps/console', ['apps/console'],
    ),
    [],
  );
});

// --- meta -------------------------------------------------------------------

/**
 * Every rule the CLI runs must have at least one test that makes it fire.
 * Otherwise a rule can be added, never match anything, and look like coverage —
 * the same guard tools/secret-scan carries for the same reason.
 */
test('every rule has a test that makes it fire', () => {
  const fired = new Set<string>();
  const collect = (fs: Finding[]): void => { for (const f of fs) fired.add(f.rule); };

  collect(ruleNoEmittedArtifactCommitted(['tools/x/src/a.js']));
  collect(ruleDeclaredDependencies([{ ...ROOT, dependencies: { express: '^4' } }]));
  collect(ruleLockfileMatchesManifests({ lockfileVersion: 2 }, [ROOT], []));
  collect(ruleToolingClosureIsPinned(lock({ 'node_modules/left-pad': { dev: true } }), [ROOT]));
  collect(ruleNoBuildStepOutsideApps([ROOT], { compilerOptions: {} }));
  collect(ruleEveryWorkspaceIsTypechecked(['apps/console'], [], 'tsc --noEmit'));

  assert.deepEqual([...fired].sort(), [
    'declared-dependencies',
    'every-workspace-is-typechecked',
    'lockfile-matches-manifests',
    'no-build-step-outside-apps',
    'no-emitted-artifact-committed',
    'tooling-closure-is-pinned',
  ]);
});

test('every pinned closure entry states why it is there', () => {
  for (const [name, reason] of Object.entries(TOOLING_CLOSURE)) {
    assert.ok(reason.length > 20, `${name} needs a real reason, not a placeholder`);
  }
});
