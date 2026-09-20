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
  const violations: Violation[] = [];
  let filesChecked = 0;

  for (const ws of workspaces) {
    const from = classify(ws);
    for (const file of sourceFiles(ws)) {
      filesChecked++;
      const source = readFileSync(file, 'utf8');
      for (const specifier of extractImports(source)) {
        const target = resolveWorkspace(file, specifier, workspaces);
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
