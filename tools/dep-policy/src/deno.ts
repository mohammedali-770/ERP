/**
 * The edge functions' one dependency, held to the same standard as the tooling's two.
 *
 * ADR-0023 put the database credential in Supabase Edge Functions, which run on Deno,
 * and the owner chose postgres.js to connect (2026-10-03). That is the first
 * third-party RUNTIME dependency outside `apps/*`. npm's lockfile never sees it: Deno
 * resolves `npm:` specifiers itself and records them in `supabase/functions/deno.lock`.
 * So without these rules it would be the one dependency in the repository nothing
 * checks — added by one line in an import map, and widened the same way.
 *
 * What holds, mechanically:
 *   - deno.json maps exactly the pinned packages, each to an exact version, and nothing
 *     else: no scopes, no workspace, no second import map;
 *   - deno.lock records exactly those versions, each with an integrity hash, and no
 *     other package, JSR module or remote URL — so a transitive dependency appearing is
 *     a finding, not a silent arrival;
 *   - no source under supabase/functions imports anything but a relative path inside it,
 *     or a pinned name, and only `_deno/` may import a pinned name: `_shared/` stays
 *     plain TypeScript that Node can typecheck and test (its Node tests may also use
 *     node:test and node:assert/strict, which nothing deployed reaches);
 *   - no other manifest, lockfile or import map exists anywhere under supabase/.
 */
import { posix } from 'node:path';
import type { Finding } from './rules.ts';

export const EDGE_DIR = 'supabase/functions';
export const EDGE_CONFIG = `${EDGE_DIR}/deno.json`;
export const EDGE_LOCK = `${EDGE_DIR}/deno.lock`;

/** The edge's permitted dependencies, each with the reason it is there. */
export const EDGE_DEPENDENCIES: Readonly<Record<string, string>> = {
  postgres: 'ADR-0023 addendum — the driver the owner chose on 2026-10-03; it has no dependencies of its own',
};

/** Only this directory may import a pinned dependency. */
const DRIVER_DIR = `${EDGE_DIR}/_deno/`;
/** And this one may import nothing outside itself. */
const PLAIN_DIR = `${EDGE_DIR}/_shared/`;
/**
 * Node runs these, and no function's import graph reaches them, so nothing here is
 * deployed: they may use Node's own test runner and assertions, and nothing else new.
 */
const NODE_TEST_DIR = `${PLAIN_DIR}test/`;
const NODE_TEST_BUILTINS = new Set(['node:test', 'node:assert/strict']);

const ALLOWED_CONFIG_KEYS = new Set(['imports', 'nodeModulesDir', 'lock']);
const EXACT = /^npm:([a-z0-9@/._-]+)@(\d+\.\d+\.\d+)$/;

export interface DenoConfig {
  readonly [key: string]: unknown;
}

export interface DenoLock {
  readonly specifiers?: Readonly<Record<string, string>>;
  readonly npm?: Readonly<Record<string, { readonly integrity?: string; readonly dependencies?: unknown }>>;
  readonly [key: string]: unknown;
}

const finding = (rule: string, message: string, remedy: string): Finding => ({ rule, message, remedy });

/** name → exact version, from deno.json's imports, for the pinned names that are well formed. */
export function pinnedVersions(config: DenoConfig | null): Map<string, string> {
  const pinned = new Map<string, string>();
  const imports = config?.['imports'];
  if (typeof imports !== 'object' || imports === null) return pinned;
  for (const [name, target] of Object.entries(imports as Record<string, unknown>)) {
    const match = typeof target === 'string' ? EXACT.exec(target) : null;
    if (match !== null && match[1] === name && name in EDGE_DEPENDENCIES) pinned.set(name, match[2]!);
  }
  return pinned;
}

export function ruleEdgeDependencyMap(config: DenoConfig | null): Finding[] {
  const rule = 'edge-dependency-map';
  if (config === null) {
    return [finding(rule, `${EDGE_CONFIG} is missing`,
      'the edge functions resolve their dependencies through it; restore it from git')];
  }
  const findings: Finding[] = [];
  for (const key of Object.keys(config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      findings.push(finding(rule, `${EDGE_CONFIG} sets "${key}"`,
        `only ${[...ALLOWED_CONFIG_KEYS].join(', ')} are permitted; anything else can add or redirect a dependency`));
    }
  }
  if (config['nodeModulesDir'] !== 'none') {
    findings.push(finding(rule, `${EDGE_CONFIG} does not set "nodeModulesDir": "none"`,
      'without it Deno may resolve from the root node_modules, which the npm lockfile governs, not deno.lock'));
  }
  if (config['lock'] === false) {
    findings.push(finding(rule, `${EDGE_CONFIG} turns the lockfile off`,
      'deno.lock is what records each dependency\'s integrity hash'));
  }

  const imports = config['imports'];
  const entries = typeof imports === 'object' && imports !== null
    ? Object.entries(imports as Record<string, unknown>) : [];
  const names = entries.map(([name]) => name);
  for (const [name, target] of entries) {
    if (!(name in EDGE_DEPENDENCIES)) {
      findings.push(finding(rule, `${EDGE_CONFIG} maps "${name}", which is not a permitted edge dependency`,
        'a new runtime dependency needs an ADR, as the tooling\'s third would; then add it to EDGE_DEPENDENCIES with its reason'));
      continue;
    }
    const match = typeof target === 'string' ? EXACT.exec(target) : null;
    if (match === null || match[1] !== name) {
      findings.push(finding(rule, `${EDGE_CONFIG} maps "${name}" to ${JSON.stringify(target)}, not an exact npm:${name}@x.y.z`,
        'pin the exact version; a range lets a deploy resolve something nobody reviewed'));
    }
  }
  for (const name of Object.keys(EDGE_DEPENDENCIES)) {
    if (!names.includes(name)) {
      findings.push(finding(rule, `${EDGE_CONFIG} does not map "${name}"`,
        'remove it from EDGE_DEPENDENCIES if the edge no longer needs it, or restore the mapping'));
    }
  }
  return findings;
}

export function ruleEdgeLockfile(config: DenoConfig | null, lock: DenoLock | null): Finding[] {
  const rule = 'edge-lockfile';
  if (lock === null) {
    return [finding(rule, `${EDGE_LOCK} is missing`,
      'run `deno install --config supabase/functions/deno.json` (or deno check) and commit deno.lock')];
  }
  const findings: Finding[] = [];
  const pinned = pinnedVersions(config);
  const expectedNpm = new Set([...pinned].map(([name, version]) => `${name}@${version}`));
  const expectedSpecifiers = new Map([...pinned].map(([name, version]) => [`npm:${name}@${version}`, version]));

  for (const key of ['jsr', 'remote', 'redirects']) {
    const value = lock[key];
    if (value !== undefined && typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
      findings.push(finding(rule, `${EDGE_LOCK} records ${key} entries: ${Object.keys(value).join(', ')}`,
        'the edge depends on the pinned npm packages only; a JSR module or a URL import is a dependency nothing pins'));
    }
  }

  const specifiers = lock.specifiers ?? {};
  for (const [specifier, version] of Object.entries(specifiers)) {
    if (expectedSpecifiers.get(specifier) !== version) {
      findings.push(finding(rule, `${EDGE_LOCK} resolves ${specifier} to ${version}, which deno.json does not pin`,
        'regenerate deno.lock from deno.json; they disagree'));
    }
  }
  for (const specifier of expectedSpecifiers.keys()) {
    if (!(specifier in specifiers)) {
      findings.push(finding(rule, `${EDGE_LOCK} does not record ${specifier}`,
        'regenerate deno.lock from deno.json, or a deploy resolves it unlocked'));
    }
  }

  const npm = lock.npm ?? {};
  for (const [entry, record] of Object.entries(npm)) {
    if (!expectedNpm.has(entry)) {
      findings.push(finding(rule, `${EDGE_LOCK} holds ${entry}, which is not a pinned edge dependency`,
        'a transitive dependency has arrived; it needs the same decision a direct one does'));
      continue;
    }
    if (typeof record.integrity !== 'string' || !record.integrity.startsWith('sha512-')) {
      findings.push(finding(rule, `${EDGE_LOCK} records no sha512 integrity for ${entry}`,
        'regenerate deno.lock; an unhashed entry is not locked'));
    }
  }
  for (const entry of expectedNpm) {
    if (!(entry in npm)) {
      findings.push(finding(rule, `${EDGE_LOCK} does not lock ${entry}`, 'regenerate deno.lock from deno.json'));
    }
  }
  return findings;
}

/**
 * The source with its comments blanked — newlines kept — and everything else untouched.
 *
 * A scanner, not a regex, because a comment delimiter can sit inside a string or a regex
 * literal: stripping `/* … *\/` by pattern let `const marker = "/*";` erase every import
 * after it, an import from outside supabase/functions among them (found by Codex on
 * PR #32). Strings ('', "", ``) and regex literals are copied whole, escapes included. A
 * `/` starts a regex literal where an expression may begin: at the start, or after one of
 * ( , = : [ ! & | ? { } ; + - * % < > ~ ^ or the keyword return; anywhere else it divides.
 */
export function withoutComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  /** The last character that was not whitespace or a comment, for the regex rule. */
  let previous = '';
  const startsExpression = () =>
    previous === '' || '(,=:[!&|?{};+-*%<>~^'.includes(previous) || /\breturn$/.test(out.trimEnd());
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i += 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || (c === '/' && startsExpression())) {
      const close = c;
      let inClass = false;
      out += c;
      i++;
      while (i < n) {
        const d = source[i]!;
        out += d;
        i++;
        if (d === '\\' && i < n) {
          out += source[i];
          i++;
          continue;
        }
        if (close === '/') {
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
          else if (d === '\n') break;
          continue;
        }
        if (d === close) break;
      }
      previous = c === '/' ? 'regex' : 'string';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) previous = c;
    i++;
  }
  return out;
}

/** Every module specifier a TypeScript source names: static imports, re-exports, dynamic imports. */
export function specifiers(source: string): string[] {
  const found: string[] = [];
  // Comments first, so a commented-out import is not read and a statement after a comment
  // is — by a scanner that knows strings, so a delimiter inside one hides nothing.
  const code = withoutComments(source);
  // A statement starts a line or follows `;` or `}`, so the word "import" inside a string
  // — the items function's '/import' route — is not read as one (found when that route
  // was added), and a second import on the same line still is (found in review: the first
  // fix anchored to line start alone and missed it). A dynamic import() can sit anywhere
  // in an expression, so it is not anchored.
  const patterns = [
    /(?:^|[;}])[ \t]*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /(?:^|[;}])[ \t]*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of code.matchAll(pattern)) found.push(m[1]!);
  return found;
}

export function ruleEdgeImports(files: ReadonlyArray<{ readonly path: string; readonly source: string }>): Finding[] {
  const rule = 'edge-imports';
  const findings: Finding[] = [];
  for (const { path, source } of files) {
    for (const specifier of specifiers(source)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const target = posix.normalize(posix.join(posix.dirname(path), specifier));
        if (!target.startsWith(`${EDGE_DIR}/`)) {
          findings.push(finding(rule, `${path} imports ${specifier}, outside ${EDGE_DIR}`,
            'an edge function is deployed on its own; it can reach only what is under supabase/functions'));
        } else if (path.startsWith(PLAIN_DIR) && !target.startsWith(PLAIN_DIR)) {
          findings.push(finding(rule, `${path} imports ${specifier}, outside _shared/`,
            '_shared/ is plain TypeScript that Node typechecks and tests; the driver and Deno stay in _deno/'));
        }
        continue;
      }
      if (path.startsWith(NODE_TEST_DIR) && NODE_TEST_BUILTINS.has(specifier)) continue;
      if (specifier in EDGE_DEPENDENCIES) {
        if (!path.startsWith(DRIVER_DIR)) {
          findings.push(finding(rule, `${path} imports "${specifier}"; only _deno/ may`,
            'keep the driver behind the Db interface in _shared/db.ts, so everything else stays testable under Node'));
        }
        continue;
      }
      findings.push(finding(rule, `${path} imports "${specifier}"`,
        `an edge source imports relative paths and ${Object.keys(EDGE_DEPENDENCIES).join(', ')} only; ` +
        'a URL, jsr:, npm: or node: specifier is an unpinned dependency'));
    }
  }
  return findings;
}

/** No second manifest, lockfile or import map anywhere under supabase/. */
export function ruleEdgeHasOneConfig(tracked: readonly string[]): Finding[] {
  const config = /(?:^|\/)(?:deno\.jsonc?|deno\.lock|import_map\.json|package\.json|package-lock\.json)$/;
  return tracked
    .filter((f) => f.startsWith('supabase/') && config.test(f) && f !== EDGE_CONFIG && f !== EDGE_LOCK)
    .map((f) => finding('edge-has-one-config', `${f} is a second dependency manifest under supabase/`,
      `every function resolves through ${EDGE_CONFIG} and ${EDGE_LOCK}; a per-function file escapes both`));
}
