/**
 * Enforces two rules this repository has stated since it began and never checked.
 *
 *   CLAUDE.md:168   "Node 22 runs TypeScript directly by stripping types. There is
 *                    no build step."
 *   CLAUDE.md:169   "Only two dependencies, deliberately: TypeScript and Node types
 *                    ... the tooling that defines the requirement baseline should
 *                    carry no supply-chain risk."
 *
 * They were absent from CLAUDE.md's enforced table, invisible to boundary-check —
 * which skips every third-party specifier — and read by no test. Two things had
 * already drifted by the time this was written: sixteen emitted `.js`/`.d.ts` files
 * were committed into `tools/prd-extract/src/`, where `.gitignore`'s `dist/` could
 * not see them.
 *
 * ADR-0021 §4 scopes the rules. `apps/*` may have a build step and its own
 * dependencies, because a React application cannot honour them and does not
 * threaten what they protect. Everywhere else they hold, and now they hold
 * mechanically.
 *
 * WHY PROVENANCE AND NOT A COUNT, since counting is the obvious design.
 * `undici-types` is a transitive dependency of `@types/node`, so "two
 * dependencies" has never meant two lockfile entries — a count fails on day one.
 * Worse, npm workspaces hoist: once `apps/console` declares React and Vite, the
 * single root lockfile holds hundreds of registry entries with nothing recording
 * which workspace asked for them. So the load-bearing assertions are the manifest
 * edges, and the tooling closure is identified by what is NOT reachable from an
 * app rather than by an allowlist that would grow forever.
 */

/** A workspace manifest as this checker needs to see it. */
export interface Manifest {
  /** Workspace-relative directory, e.g. "tools/req-lint". `.` for the root. */
  readonly workspace: string;
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

/** One entry of `package-lock.json`'s `packages` map. */
export interface LockEntry {
  readonly name?: string;
  readonly version?: string;
  readonly resolved?: string;
  readonly link?: boolean;
  readonly dev?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly workspaces?: readonly string[];
}

export interface Lockfile {
  readonly lockfileVersion?: number;
  readonly packages?: Readonly<Record<string, LockEntry>>;
}

export interface Finding {
  readonly rule: string;
  readonly message: string;
  /** What to do about it. Every other checker here names the remedy; so does this one. */
  readonly remedy: string;
}

/**
 * Packages permitted in the tooling's own closure, each with the reason it is
 * there. Deliberately tiny, and deliberately listing the transitive one
 * explicitly: `undici-types` is legitimate only because `@types/node` requires
 * it, and that justification should be written down rather than inferred.
 */
export const TOOLING_CLOSURE: Readonly<Record<string, string>> = {
  typescript: 'CLAUDE.md:169 — one of the two permitted dependencies',
  '@types/node': 'CLAUDE.md:169 — the other',
  'undici-types': 'transitive of @types/node; not declared anywhere by us',
};

/** Layers whose dependencies and build output are unconstrained (ADR-0021 §4). */
export const EXEMPT_PREFIX = 'apps/';

const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** Emitted JavaScript and declaration output. `.d.ts` is included: it is emit too. */
const EMITTED = /\.(?:js|mjs|cjs|jsx)$|\.d\.ts$|\.(?:js|mjs|cjs|d\.ts)\.map$/;

const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'] as const;

const BUNDLERS = /\b(?:vite|tsup|esbuild|rollup|webpack|parcel|swc|babel|browserify)\b/;

const exempt = (path: string): boolean => path.startsWith(EXEMPT_PREFIX);

/**
 * No emitted artifact is committed outside `apps/*`.
 *
 * `tracked` is the output of `git ls-files`. The working tree is not consulted on
 * purpose: `dist/` is git-ignored and local build output is nobody's business, but
 * a *tracked* `.js` file is a build step that happened and was recorded.
 */
export function ruleNoEmittedArtifactCommitted(tracked: readonly string[]): Finding[] {
  return tracked
    .filter((f) => !exempt(f) && EMITTED.test(f))
    .map((file) => ({
      rule: 'no-emitted-artifact-committed',
      message: `${file} is build output and is tracked by git`,
      remedy: 'delete it; Node runs the TypeScript source directly (CLAUDE.md:168)',
    }));
}

/**
 * The root declares exactly the two permitted dependencies, and no workspace
 * outside `apps/*` declares any at all.
 */
export function ruleDeclaredDependencies(manifests: readonly Manifest[]): Finding[] {
  const findings: Finding[] = [];
  for (const m of manifests) {
    if (exempt(m.workspace)) continue;

    if (m.workspace === '.') {
      const runtime = Object.keys(m.dependencies ?? {});
      if (runtime.length > 0) {
        findings.push({
          rule: 'declared-dependencies',
          message: `the root declares runtime dependencies: ${runtime.join(', ')}`,
          remedy: 'the runtime is `node --experimental-strip-types`; a runtime dependency here is a category error',
        });
      }
      const dev = Object.keys(m.devDependencies ?? {}).sort();
      const allowed = ['@types/node', 'typescript'];
      if (dev.join(',') !== allowed.join(',')) {
        findings.push({
          rule: 'declared-dependencies',
          message: `the root declares devDependencies [${dev.join(', ')}], expected [${allowed.join(', ')}]`,
          remedy: 'CLAUDE.md:169 permits two. A third needs an ADR amending that rule, not a quiet install',
        });
      }
      continue;
    }

    for (const key of DEP_KEYS) {
      const declared = Object.keys(m[key] ?? {});
      if (declared.length > 0) {
        findings.push({
          rule: 'declared-dependencies',
          message: `${m.workspace} declares ${key}: ${declared.join(', ')}`,
          remedy: `only ${EXEMPT_PREFIX}* may declare dependencies (ADR-0021 §4)`,
        });
      }
    }
  }
  return findings;
}

/**
 * The lockfile agrees with the manifests.
 *
 * This is what stops `declared-dependencies` passing vacuously. A dependency added
 * to a manifest without `npm install` leaves the lockfile stale, and a dependency
 * installed without being declared leaves a manifest innocent — either way the two
 * disagree, and either way it is caught here.
 */
export function ruleLockfileMatchesManifests(
  lock: Lockfile,
  manifests: readonly Manifest[],
  workspaceDirs: readonly string[],
): Finding[] {
  const findings: Finding[] = [];

  if (lock.lockfileVersion !== 3) {
    findings.push({
      rule: 'lockfile-matches-manifests',
      message: `lockfileVersion is ${String(lock.lockfileVersion)}, expected 3`,
      remedy: 'v2 carries a second legacy dependency tree that these assertions do not read; regenerate with npm 9+',
    });
    return findings;
  }

  const packages = lock.packages ?? {};
  const pathEntries = Object.keys(packages).filter((k) => k !== '' && !k.startsWith('node_modules/'));

  for (const path of pathEntries) {
    if (exempt(path)) continue;
    const entry = packages[path]!;
    for (const key of DEP_KEYS) {
      if (Object.keys(entry[key] ?? {}).length > 0) {
        findings.push({
          rule: 'lockfile-matches-manifests',
          message: `the lockfile records ${key} for ${path}`,
          remedy: `only ${EXEMPT_PREFIX}* may declare dependencies (ADR-0021 §4)`,
        });
      }
    }
  }

  // A workspace that exists on disk but not in the lockfile means the lockfile is
  // stale, which would let every assertion above pass over an absent entry.
  const known = new Set(pathEntries);
  for (const dir of workspaceDirs) {
    if (!known.has(dir)) {
      findings.push({
        rule: 'lockfile-matches-manifests',
        message: `${dir} is a workspace on disk with no lockfile entry`,
        remedy: 'run `npm install` and commit the lockfile; a stale lockfile makes these checks vacuous',
      });
    }
  }

  // And the reverse: a link pointing at a directory that is gone.
  for (const [key, entry] of Object.entries(packages)) {
    if (entry.link !== true) continue;
    const target = entry.resolved;
    if (target !== undefined && !workspaceDirs.includes(target)) {
      findings.push({
        rule: 'lockfile-matches-manifests',
        message: `${key} links to ${target}, which is not a workspace on disk`,
        remedy: 'run `npm install` and commit the lockfile',
      });
    }
  }

  const rootDeclared = manifests.find((m) => m.workspace === '.');
  const rootEntry = packages[''];
  if (rootDeclared !== undefined && rootEntry !== undefined) {
    const a = Object.keys(rootDeclared.devDependencies ?? {}).sort().join(',');
    const b = Object.keys(rootEntry.devDependencies ?? {}).sort().join(',');
    if (a !== b) {
      findings.push({
        rule: 'lockfile-matches-manifests',
        message: `root devDependencies differ: package.json [${a}] vs lockfile [${b}]`,
        remedy: 'run `npm install` and commit the lockfile',
      });
    }
  }

  return findings;
}

/**
 * Every registry package that is NOT reachable from an app is in the pinned
 * tooling closure.
 *
 * Reachability, rather than an allowlist of everything, is what survives
 * `apps/console` declaring React and Vite: their hundreds of transitive packages
 * are excluded because an app asked for them, while anything that appears without
 * an app asking is a new dependency of the tooling and must be declared here on
 * purpose.
 */
export function ruleToolingClosureIsPinned(lock: Lockfile, manifests: readonly Manifest[]): Finding[] {
  const packages = lock.packages ?? {};

  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const m of manifests) {
    if (!exempt(m.workspace)) continue;
    for (const key of DEP_KEYS) queue.push(...Object.keys(m[key] ?? {}));
  }
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (reachable.has(name)) continue;
    reachable.add(name);
    const entry = packages[`node_modules/${name}`];
    if (entry === undefined) continue;
    for (const key of DEP_KEYS) queue.push(...Object.keys(entry[key] ?? {}));
  }

  const findings: Finding[] = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith('node_modules/') || entry.link === true) continue;
    const name = key.slice('node_modules/'.length);
    if (reachable.has(name)) continue;
    if (name in TOOLING_CLOSURE) {
      if (entry.dev !== true) {
        findings.push({
          rule: 'tooling-closure-is-pinned',
          message: `${name} is in the tooling closure but is not marked dev`,
          remedy: 'the runtime strips types and runs sources; nothing here belongs in `dependencies`',
        });
      }
      continue;
    }
    findings.push({
      rule: 'tooling-closure-is-pinned',
      message: `${name} is installed, is not reachable from any ${EXEMPT_PREFIX}* manifest, and is not in the pinned closure`,
      remedy: 'if the tooling genuinely needs it, add it to TOOLING_CLOSURE with the reason — that is the decision CLAUDE.md:169 asks you to think hard about',
    });
  }
  return findings;
}

/** There is no build step outside `apps/*`. */
export function ruleNoBuildStepOutsideApps(
  manifests: readonly Manifest[],
  // `noEmit` is a compilerOption; `references` is top level. Reading noEmit from
  // the top level is the first bug this checker found, in itself.
  rootTsconfig: { compilerOptions?: { noEmit?: unknown }; references?: unknown },
): Finding[] {
  const findings: Finding[] = [];

  for (const m of manifests) {
    if (exempt(m.workspace)) continue;
    const scripts = m.scripts ?? {};

    for (const hook of LIFECYCLE) {
      if (hook in scripts) {
        findings.push({
          rule: 'no-build-step-outside-apps',
          message: `${m.workspace} declares a ${hook} script`,
          remedy: 'an install hook is the supply-chain surface the two-dependency rule exists to avoid (supabase/README.md:39-42)',
        });
      }
    }

    if (m.workspace === '.') {
      // The root's `build` is `tsc --noEmit` — identical to `typecheck`. Assert its
      // value rather than its absence, so a future `build` that actually emits is
      // caught instead of exempted.
      if ('build' in scripts && scripts.build !== 'tsc --noEmit') {
        findings.push({
          rule: 'no-build-step-outside-apps',
          message: `the root build script is "${scripts.build}", expected "tsc --noEmit"`,
          remedy: 'CLAUDE.md:168 — there is no build step. An emitting build needs an ADR',
        });
      }
      for (const [name, body] of Object.entries(scripts)) {
        if (BUNDLERS.test(body)) {
          findings.push({
            rule: 'no-build-step-outside-apps',
            message: `the root script "${name}" invokes a bundler: ${body}`,
            remedy: `a bundler belongs in an ${EXEMPT_PREFIX}* workspace's own scripts, not at the root`,
          });
        }
      }
      continue;
    }

    const names = Object.keys(scripts);
    if (names.length > 0) {
      findings.push({
        rule: 'no-build-step-outside-apps',
        message: `${m.workspace} declares scripts: ${names.join(', ')}`,
        remedy: 'root scripts invoke tools directly by path; a workspace script is an unused build surface',
      });
    }
  }

  if (rootTsconfig.compilerOptions?.noEmit !== true) {
    findings.push({
      rule: 'no-build-step-outside-apps',
      message: 'the root tsconfig does not set noEmit: true',
      remedy: 'tsconfig.base.json sets declaration and composite true; the root override is what keeps tsc from emitting',
    });
  }
  if (rootTsconfig.references !== undefined) {
    findings.push({
      rule: 'no-build-step-outside-apps',
      message: 'the root tsconfig declares project references',
      remedy: 'ADR-0001:35-39 rejected project references; they require an emit step the runtime does not use',
    });
  }

  return findings;
}

/**
 * Every workspace is covered by some `tsc` invocation.
 *
 * `apps/*` carries its own tsconfig, so the root `tsc --noEmit` stops covering it.
 * Without this, a workspace can be added, typechecked by nothing, and look fine —
 * which is the same class of gap as the test glob that ran tests nothing compiled.
 */
export function ruleEveryWorkspaceIsTypechecked(
  workspaceDirs: readonly string[],
  rootIncludes: readonly string[],
  typecheckScript: string,
  /**
   * Workspaces containing `.tsx` or `.jsx` sources. These need their OWN project:
   * the root include's globs end in an explicit `.ts`, which TypeScript matches
   * literally, so JSX is outside them however many `apps/*` patterns are listed.
   * Passing them separately is what makes this assertion bite — without it the
   * rule only noticed a whole workspace root being absent, which is a far rarer
   * mistake than adding JSX to a workspace with no project of its own.
   */
  jsxWorkspaces: readonly string[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const projects = [...typecheckScript.matchAll(/-p\s+(\S+)/g)].map((m) => m[1]!);
  const hasProject = (dir: string): boolean => projects.some((p) => p === dir || p.startsWith(`${dir}/`));

  for (const dir of workspaceDirs) {
    const root = dir.split('/')[0]!;
    const coveredByRoot = rootIncludes.some((pattern) => pattern.startsWith(`${root}/`));
    if (!coveredByRoot && !hasProject(dir)) {
      findings.push({
        rule: 'every-workspace-is-typechecked',
        message: `${dir} is in no tsconfig include and no -p project of the typecheck script`,
        remedy: 'add it to tsconfig.json\'s include, or give it its own tsconfig and a `tsc -p` in the typecheck script',
      });
    }
  }

  for (const dir of jsxWorkspaces) {
    if (!hasProject(dir)) {
      findings.push({
        rule: 'every-workspace-is-typechecked',
        message: `${dir} contains JSX, which the root tsconfig's explicit .ts globs cannot match, and has no -p project`,
        remedy: `add \`tsc --noEmit -p ${dir}\` to the typecheck script; the root tsc does not see .tsx`,
      });
    }
  }
  return findings;
}
