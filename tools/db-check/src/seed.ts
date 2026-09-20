/**
 * Which seed files load, and in what order.
 *
 * Read from `supabase/config.toml` rather than globbed independently, because
 * two lists that are supposed to agree eventually do not. The CLI reads that
 * file; so does this, and a file present on disk but absent from the config is
 * reported rather than silently skipped.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** `sql_paths = ["./seeds/a.sql", "./seeds/b.sql"]` under `[db.seed]`. */
export function parseSeedPaths(configToml: string): string[] {
  const section = /\[db\.seed\][\s\S]*?(?=\n\[|$)/.exec(configToml);
  if (!section) return [];
  const list = /sql_paths\s*=\s*\[([\s\S]*?)\]/.exec(section[0]);
  if (!list) return [];
  return [...list[1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
}

export interface SeedPlan {
  readonly files: string[];
  /** On disk under seeds/ but not declared in config — it would never load. */
  readonly undeclared: string[];
  /** Declared but missing from disk. */
  readonly missing: string[];
}

export function planSeed(configPath: string): SeedPlan {
  if (!existsSync(configPath)) return { files: [], undeclared: [], missing: [] };
  const root = dirname(configPath);
  const declared = parseSeedPaths(readFileSync(configPath, 'utf8'));
  const files = declared.map((p) => join(root, p.replace(/^\.\//, '')));

  const seedsDir = join(root, 'seeds');
  const onDisk = existsSync(seedsDir)
    ? readdirSync(seedsDir).filter((f) => f.endsWith('.sql')).map((f) => join(seedsDir, f))
    : [];

  return {
    files,
    undeclared: onDisk.filter((f) => !files.includes(f)),
    missing: files.filter((f) => !existsSync(f)),
  };
}
