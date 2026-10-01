/**
 * Checks every import in the repository against the dependency rule.
 *
 *   npm run boundary:check
 *
 * See docs/domain/bounded-contexts.md. Run in CI, because a boundary that is only
 * described in a document is a boundary that erodes under deadline pressure.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { classify, checkEdge, extractImports, resolveWorkspace, type Violation } from './rules.ts';

const WORKSPACE_ROOTS = ['packages', 'services', 'apps', 'tools', 'spikes'];

function discoverWorkspaces(): string[] {
  const out: string[] = [];
  for (const root of WORKSPACE_ROOTS) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const p = join(root, name);
      if (statSync(p).isDirectory()) out.push(p);
    }
  }
  return out.sort();
}

/**
 * Maps each workspace's PUBLISHED package name to its path, read from its own
 * package.json rather than derived from its directory.
 *
 * Deriving it is what broke this checker: services publish `@firsttaste/service-*`
 * and apps `@firsttaste/app-*`, so `@firsttaste/<directory>` matched only
 * packages/contracts and tools/*, and every service-to-service import written by
 * package name was invisible. A workspace with no package.json, or no name, is
 * simply absent from the map — it is then reachable only by relative path, which
 * resolves on its own.
 */
function packageNames(workspaces: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const workspace of workspaces) {
    const manifest = join(workspace, 'package.json');
    if (!existsSync(manifest)) continue;
    try {
      const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
      if (typeof name === 'string' && name.length > 0) names.set(name, workspace);
    } catch {
      // A malformed manifest is npm's problem to report, not this checker's.
      continue;
    }
  }
  return names;
}

function* sourceFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* sourceFiles(p);
    } else if (entry.name.endsWith('.ts')) {
      yield p;
    }
  }
}

function main(): void {
  const workspaces = discoverWorkspaces();
  const names = packageNames(workspaces);
  const violations: Violation[] = [];
  let filesChecked = 0;

  for (const ws of workspaces) {
    const from = classify(ws);
    for (const file of sourceFiles(ws)) {
      filesChecked++;
      const source = readFileSync(file, 'utf8');
      for (const specifier of extractImports(source)) {
        const target = resolveWorkspace(file, specifier, workspaces, names);
        if (!target) continue;
        const v = checkEdge(from, classify(target), file);
        if (v) violations.push(v);
      }
    }
  }

  console.log(`boundary-check: ${workspaces.length} workspaces, ${filesChecked} files`);
  if (violations.length === 0) {
    console.log('boundary-check: no violations');
    return;
  }
  console.error(`\nboundary-check: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.from} → ${v.to}: ${v.reason}\n`);
  }
  process.exit(1);
}

main();
