/**
 * Enforces the dependency rule from docs/domain/bounded-contexts.md.
 *
 *   apps/*      →  services/*  →  packages/contracts
 *   services/*  →  packages/contracts
 *   packages/contracts → (nothing)
 *
 * Nothing depends on an application. No service imports another service's
 * internals. This is the rule that keeps the monorepo (ADR-0001) from becoming a
 * single tangled application, and it is checked rather than trusted.
 */

export type Layer = 'app' | 'service' | 'package' | 'tool' | 'spike' | 'unknown';

export interface Module {
  /** Workspace-relative path, e.g. "services/orders". */
  readonly workspace: string;
  readonly layer: Layer;
  readonly name: string;
}

export interface Violation {
  readonly from: string;
  readonly to: string;
  readonly file: string;
  readonly reason: string;
}

export function classify(workspacePath: string): Module {
  const [dir, name] = workspacePath.split('/');
  const layer: Layer =
    dir === 'apps' ? 'app'
    : dir === 'services' ? 'service'
    : dir === 'packages' ? 'package'
    : dir === 'tools' ? 'tool'
    : dir === 'spikes' ? 'spike'
    : 'unknown';
  return { workspace: workspacePath, layer, name: name ?? workspacePath };
}

/** Which layers a given layer may import from. */
const ALLOWED: Readonly<Record<Layer, readonly Layer[]>> = {
  app: ['service', 'package'],
  service: ['package'],
  package: ['package'],
  tool: ['package', 'tool'],
  spike: ['package'],
  unknown: [],
};

export function checkEdge(from: Module, to: Module, file: string): Violation | null {
  if (from.workspace === to.workspace) return null;

  // Same-layer first: two services reaching into each other has a specific
  // remedy worth naming, and it would otherwise be masked by the generic rule.
  if (from.layer === to.layer && (from.layer === 'service' || from.layer === 'app')) {
    return {
      from: from.workspace, to: to.workspace, file,
      reason: `${from.layer}s must not import each other; communicate through published events`,
    };
  }

  if (!ALLOWED[from.layer].includes(to.layer)) {
    return {
      from: from.workspace, to: to.workspace, file,
      reason: `a ${from.layer} may not import from a ${to.layer}`,
    };
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

export function extractImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) found.push(m[1]!);
  for (const m of source.matchAll(BARE_IMPORT_RE)) found.push(m[1]!);
  return found;
}

/**
 * Resolves an import specifier to the workspace it lands in, or null for
 * node: builtins and third-party packages.
 *
 * `fromFile` is the importing file's repo-relative path. Relative specifiers
 * resolve against its DIRECTORY — resolving against the workspace root instead
 * would miscount `..` segments by one and silently miss violations.
 */
export function resolveWorkspace(
  fromFile: string,
  specifier: string,
  workspaces: readonly string[],
): string | null {
  if (specifier.startsWith('node:') || !specifier.startsWith('.')) {
    // A workspace package referenced by name, e.g. "@firsttaste/contracts".
    const byName = workspaces.find((w) => specifier === `@firsttaste/${w.split('/')[1]}`);
    return byName ?? null;
  }
  const dir = fromFile.split('/').slice(0, -1).join('/');
  const segments = `${dir}/${specifier}`.split('/');
  const resolved: string[] = [];
  for (const s of segments) {
    if (s === '.' || s === '') continue;
    if (s === '..') resolved.pop();
    else resolved.push(s);
  }
  const joined = resolved.join('/');
  return workspaces.find((w) => joined === w || joined.startsWith(`${w}/`)) ?? null;
}
