/**
 * A throwaway PostgreSQL cluster, driven by initdb/pg_ctl/psql.
 *
 * No Docker and no dependency: the point is that this runs in a session or on a
 * CI runner that has Postgres but no container daemon, so the migrations are
 * provable in more places than the full Supabase stack is. It proves structure,
 * not Supabase behaviour — storage and auth policies are the pgTAP suite's job.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * PostgreSQL refuses to run as root, and correctly so. In a container the
 * session often IS root, so the cluster runs as an unprivileged user and the
 * scratch directories are handed to it. On a developer machine or a CI runner
 * this is a no-op, because neither is root.
 */
interface Unprivileged {
  readonly user: string;
  readonly uid: number;
  readonly gid: number;
}

function unprivilegedUser(): Unprivileged | null {
  if (process.getuid?.() !== 0) return null;
  for (const user of ['postgres', 'nobody']) {
    const r = spawnSync('getent', ['passwd', user], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) {
      const parts = r.stdout.trim().split(':');
      return { user, uid: Number(parts[2]), gid: Number(parts[3]) };
    }
  }
  throw new Error(
    'running as root and no unprivileged user (postgres, nobody) exists to run PostgreSQL as.',
  );
}

const PG_BIN_CANDIDATES = [
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/15/bin',
  '/usr/pgsql-16/bin',
];

export function findPostgresBin(): string | null {
  for (const dir of PG_BIN_CANDIDATES) {
    if (existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl'))) return dir;
  }
  // Fall back to whatever is on PATH.
  const which = spawnSync('which', ['initdb'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim().replace(/\/initdb$/, '');
  }
  return null;
}

export interface Cluster {
  readonly dataDir: string;
  readonly socketDir: string;
  readonly database: string;
  /** Creates an additional empty database in the same cluster. */
  createDatabase(name: string): void;
  /** Runs SQL against a named database. */
  sqlIn(database: string, statement: string): string;
  /** Runs a file against a named database. */
  fileIn(database: string, path: string): string;
  /** Data-only dump, used to compare two builds for identical state. */
  dumpData(database: string): string;
  /** Runs SQL as the superuser and returns stdout. Throws with psql's stderr on failure. */
  sql(statement: string): string;
  /** Runs a file. Fails on the first error rather than continuing. */
  file(path: string): string;
  stop(): void;
}

export function startCluster(binDir: string, database = 'erp_check'): Cluster {
  const as = unprivilegedUser();
  const root = mkdtempSync(join(tmpdir(), 'erp-dbcheck-'));
  const dataDir = join(root, 'data');
  const socketDir = join(root, 'sock');
  const logFile = join(root, 'pg.log');

  mkdirSync(socketDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  if (as) {
    for (const dir of [root, dataDir, socketDir]) chownSync(dir, as.uid, as.gid);
  }

  /** Runs a PostgreSQL binary, dropping privileges when the session is root. */
  const run = (bin: string, args: string[], input?: string) => {
    const exe = as ? 'setpriv' : join(binDir, bin);
    const argv = as
      ? [`--reuid=${as.uid}`, `--regid=${as.gid}`, '--clear-groups', join(binDir, bin), ...args]
      : args;
    return spawnSync(exe, argv, { encoding: 'utf8', input, env: { ...process.env, PGHOST: socketDir } });
  };

  const mustRun = (bin: string, args: string[]): string => {
    const r = run(bin, args);
    if (r.status !== 0) {
      throw new Error(`${bin} failed:\n${r.stderr || r.stdout}\n${existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''}`);
    }
    return r.stdout;
  };

  mustRun('initdb', ['-D', dataDir, '-A', 'trust', '-U', 'postgres', '--no-sync']);
  // Unix socket only: no TCP port, so concurrent runs and a developer's own
  // Postgres on 5432 cannot collide.
  mustRun('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h '' -c fsync=off`, '-w', '-l', logFile, 'start']);

  const psql = (args: string[], input?: string): string => {
    const r = run('psql', ['-h', socketDir, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], input);
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    return r.stdout;
  };

  psql(['-d', 'postgres', '-c', `create database ${database}`]);

  const dump = (db: string): string => {
    const r = run('pg_dump', ['-h', socketDir, '-U', 'postgres', '--data-only', '--no-owner', '-d', db]);
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    // pg_dump prefixes a \restrict directive carrying a fresh random nonce each
    // run. It is dump metadata, not database content, so comparing it would
    // report every pair of builds as different.
    return r.stdout
      .split('\n')
      .filter((line) => !/^\\(un)?restrict /.test(line))
      .join('\n');
  };

  return {
    dataDir,
    socketDir,
    database,
    sql: (statement) => psql(['-d', database, '-t', '-A', '-c', statement]),
    file: (path) => psql(['-d', database, '-f', path]),
    createDatabase: (name) => { psql(['-d', 'postgres', '-c', `create database ${name}`]); },
    sqlIn: (db, statement) => psql(['-d', db, '-t', '-A', '-c', statement]),
    fileIn: (db, path) => psql(['-d', db, '-f', path]),
    dumpData: dump,
    stop() {
      run('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop']);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function readSql(path: string): string {
  return readFileSync(path, 'utf8');
}
