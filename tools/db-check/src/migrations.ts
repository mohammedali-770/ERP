/**
 * Discovering and ordering migration files.
 *
 * Split out from the cluster work so the ordering rules — the part that is easy
 * to get subtly wrong and impossible to notice — are unit-testable without a
 * database.
 */
import { readdirSync } from 'node:fs';

/** `<14-digit timestamp>_<name>.sql`, the form the Supabase CLI writes and reads. */
export const MIGRATION_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly file: string;
}

/**
 * Migrations apply in version order, which for this naming is also lexical
 * order — but only because the timestamps are fixed-width. Sorting by the parsed
 * version rather than by filename means a future rename cannot quietly reorder
 * history.
 */
export function orderMigrations(files: readonly string[]): Migration[] {
  const out: Migration[] = [];
  for (const file of files) {
    const m = MIGRATION_NAME.exec(file);
    if (!m) continue;
    out.push({ version: m[1]!, name: m[2]!, file });
  }
  out.sort((a, b) => a.version.localeCompare(b.version));
  return out;
}

/** Two migrations sharing a version is ambiguous history, not a style problem. */
export function duplicateVersions(migrations: readonly Migration[]): string[] {
  const seen = new Map<string, number>();
  for (const m of migrations) seen.set(m.version, (seen.get(m.version) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);
}

/** Files in the directory that are not migrations at all — a typo hides silently otherwise. */
export function unrecognisedFiles(files: readonly string[]): string[] {
  return files.filter((f) => f.endsWith('.sql') && !MIGRATION_NAME.test(f));
}

export function loadMigrations(dir: string): Migration[] {
  return orderMigrations(readdirSync(dir));
}
