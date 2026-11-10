/**
 * Running Postgres's own tools for the corpus transfer (#1439).
 *
 * The transfer moves tens of gigabytes, which is `pg_dump`/`pg_restore`
 * work, not something to stream through a Node client. Neither host has the
 * client binaries installed, and both run the database in a container that
 * does — at the server's exact version, with local socket access that needs
 * no password. So by default every call is `docker exec` into that
 * container. {@link localPg} is the same contract against binaries on PATH,
 * for a host that has them.
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';

/** A precondition failed: nothing was written, and the reason is safe to print. */
export class RefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusalError';
  }
}

export interface PgRunner {
  /** Run SQL, returning each output row as its fields. */
  psql(database: string, sql: string): Promise<string[][]>;
  /** `pg_dump <args>` of `database`, written to `file`. */
  dumpToFile(database: string, args: string[], file: string): Promise<void>;
  /** `pg_restore <args>` of `file` into `database`. */
  restoreFromFile(
    database: string,
    args: string[],
    file: string,
  ): Promise<void>;
  /** `pg_restore -l`: the archive's table of contents. */
  listArchive(file: string): Promise<string>;
}

const FIELD_SEP = '\x1f';

interface Invocation {
  command: string;
  args: string[];
  stdinFile?: string;
  stdinText?: string;
  stdoutFile?: string;
}

/**
 * Drop the lines of a Postgres error that quote row values.
 *
 * A constraint violation's `DETAIL: Key (email)=(…)` names the row that
 * broke it, and on the swap's side that row can be a user's. The message
 * and hint are enough to act on; the value never needs to reach a log.
 */
export function sanitizeStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !/^\s*(DETAIL|CONTEXT|LINE \d+|\s*\^)/.test(line))
    .join('\n')
    .trim()
    .slice(0, 2000);
}

function invoke({
  command,
  args,
  stdinFile,
  stdinText,
  stdoutFile,
}: Invocation): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    // A dump is complete when its file is flushed, not when pg_dump exits:
    // checksumming on exit could hash a file still short of its last write.
    const flushed = new Promise<void>((done, fail) => {
      if (!stdoutFile) {
        child.stdout.on('data', (b: Buffer) => out.push(b));
        return done();
      }
      const file = createWriteStream(stdoutFile);
      file.on('finish', done).on('error', fail);
      child.stdout.pipe(file);
    });
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const tool = args.find((a) => /^(psql|pg_dump|pg_restore)$/.test(a));
        return reject(
          new Error(
            `${tool ?? command} exited ${code}: ` +
              sanitizeStderr(Buffer.concat(err).toString('utf8')),
          ),
        );
      }
      flushed
        .then(() => resolve(Buffer.concat(out).toString('utf8')))
        .catch(reject);
    });
    if (stdinFile) createReadStream(stdinFile).pipe(child.stdin);
    else child.stdin.end(stdinText ?? '');
  });
}

export function parseRows(stdout: string): string[][] {
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(FIELD_SEP));
}

type Wrap = (tool: string, args: string[], stdin: boolean) => Invocation;

function runner(wrap: Wrap, dbArg: (db: string) => string[]): PgRunner {
  const psqlArgs = (db: string) => [
    ...dbArg(db),
    '-X',
    '-q',
    '-A',
    '-t',
    '-v',
    'ON_ERROR_STOP=1',
    '-F',
    FIELD_SEP,
    '-f',
    '-',
  ];
  return {
    psql: async (db, sql) =>
      parseRows(
        await invoke({ ...wrap('psql', psqlArgs(db), true), stdinText: sql }),
      ),
    dumpToFile: async (db, args, file) => {
      await invoke({
        ...wrap('pg_dump', [...dbArg(db), ...args], false),
        stdoutFile: file,
      });
    },
    restoreFromFile: async (db, args, file) => {
      await invoke({
        ...wrap('pg_restore', [...dbArg(db), ...args], true),
        stdinFile: file,
      });
    },
    listArchive: (file) =>
      invoke({ ...wrap('pg_restore', ['-l'], true), stdinFile: file }),
  };
}

/** The tools inside a running database container, over its local socket. */
export function containerPg(container: string, user = 'postgres'): PgRunner {
  return runner(
    (tool, args, stdin) => ({
      command: 'docker',
      args: ['exec', ...(stdin ? ['-i'] : []), container, tool, ...args],
    }),
    (db) => ['-U', user, '-d', db],
  );
}

/** The tools on PATH, connecting as libpq's `PG*` environment says. */
export function localPg(): PgRunner {
  return runner(
    (tool, args) => ({ command: tool, args }),
    (db) => ['-d', db],
  );
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Quote an identifier that came from this tool's own lists or the catalog.
 * Anything outside plain lower-case names is refused rather than escaped:
 * no table this tool moves needs more, so an odd name is a bug to stop on.
 */
export function ident(name: string): string {
  if (!IDENT.test(name)) {
    throw new RefusalError(`unexpected identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
