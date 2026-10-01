/**
 * Dependency and build-step policy.
 *
 *   npm run dep:policy
 *
 * Run in CI so the two rules CLAUDE.md states cannot drift the way they already
 * had by the time this was written.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  ruleNoEmittedArtifactCommitted, ruleDeclaredDependencies, ruleLockfileMatchesManifests,
  ruleToolingClosureIsPinned, ruleNoBuildStepOutsideApps, ruleEveryWorkspaceIsTypechecked,
  TOOLING_CLOSURE,
  type Finding, type Manifest, type Lockfile,
} from './rules.ts';

const WORKSPACE_ROOTS = ['packages', 'services', 'apps', 'tools', 'spikes'];

/** tsconfig.json carries `//` comments, which JSON.parse will not accept. */
function readJsonWithComments<T>(file: string): T {
  const raw = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(raw) as T;
}

/**
 * Workspace directories that carry a manifest.
 *
 * `spikes/lan-peer-sync` and `spikes/ios-durability` deliberately have none — they
 * are written as procedures rather than code, and boundary-check tolerates them for
 * the same reason. A directory with no manifest declares no dependency and has no
 * scripts, so there is nothing here for it to violate.
 */
/** Workspaces holding a .tsx or .jsx source, which the root tsconfig cannot match. */
function jsxWorkspaces(dirs: readonly string[], tracked: readonly string[]): string[] {
  return dirs.filter((dir) => tracked.some((f) => f.startsWith(`${dir}/`) && /\.(?:tsx|jsx)$/.test(f)));
}

function discoverManifests(): { dirs: string[]; manifests: Manifest[] } {
  const dirs: string[] = [];
  const manifests: Manifest[] = [
    { workspace: '.', ...readJsonWithComments<Omit<Manifest, 'workspace'>>('package.json') },
  ];
  for (const root of WORKSPACE_ROOTS) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      dirs.push(dir);
      manifests.push({ workspace: dir, ...readJsonWithComments<Omit<Manifest, 'workspace'>>(manifest) });
    }
  }
  return { dirs: dirs.sort(), manifests };
}

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((l) => l.length > 0);

const { dirs, manifests } = discoverManifests();
const root = manifests.find((m) => m.workspace === '.')!;
const lock: Lockfile = existsSync('package-lock.json')
  ? (JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lockfile)
  : {};
const tsconfig = readJsonWithComments<{
  compilerOptions?: { noEmit?: unknown };
  references?: unknown;
  include?: string[];
}>('tsconfig.json');

const findings: Finding[] = [
  ...ruleNoEmittedArtifactCommitted(tracked),
  ...ruleDeclaredDependencies(manifests),
  ...ruleLockfileMatchesManifests(lock, manifests, dirs),
  ...ruleToolingClosureIsPinned(lock, manifests),
  ...ruleNoBuildStepOutsideApps(manifests, tsconfig),
  ...ruleEveryWorkspaceIsTypechecked(
    dirs, tsconfig.include ?? [], root.scripts?.typecheck ?? '', jsxWorkspaces(dirs, tracked),
  ),
];

const registry = Object.keys(lock.packages ?? {}).filter(
  (k) => k.startsWith('node_modules/') && lock.packages![k]!.link !== true,
).length;

console.log(
  `dep-policy: ${manifests.length} manifests, ${tracked.length} tracked files, ` +
  `${registry} installed package(s), ${Object.keys(TOOLING_CLOSURE).length} pinned in the tooling closure`,
);

if (findings.length === 0) {
  console.log('dep-policy: the dependency and build-step rules hold');
  process.exit(0);
}

// Group by rule so a hundred findings read as a handful of actionable items,
// matching req-lint's output shape.
const byRule = new Map<string, Finding[]>();
for (const f of findings) {
  const bucket = byRule.get(f.rule) ?? [];
  bucket.push(f);
  byRule.set(f.rule, bucket);
}
for (const [rule, items] of byRule) {
  console.error(`\n  ERROR ${rule} (${items.length})`);
  for (const f of items.slice(0, 8)) console.error(`      ${f.message}`);
  if (items.length > 8) console.error(`      ... and ${items.length - 8} more`);
  console.error(`      → ${items[0]!.remedy}`);
}
console.error(`\ndep-policy: ${findings.length} finding(s)`);
process.exit(1);
