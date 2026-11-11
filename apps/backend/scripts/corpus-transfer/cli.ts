/**
 * What the three corpus-transfer commands share at the command line (#1439).
 */
import { RefusalError, containerPg, localPg, type PgRunner } from './pg';

export function hasFlag(name: string, argv = process.argv): boolean {
  return argv.includes(`--${name}`);
}

/**
 * The value after `--name`. A missing value, or one that is itself a flag
 * (`--container --local`), is refused rather than taken: these values reach
 * `docker exec` and SQL, and a flag in their place is always a typo.
 */
export function argValue(
  name: string,
  argv = process.argv,
): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new RefusalError(`--${name} needs a value`);
  }
  return value;
}

export function runnerFromArgs(argv = process.argv): PgRunner {
  return hasFlag('local', argv)
    ? localPg()
    : containerPg(argValue('container', argv) ?? 'opuspopuli-db');
}

/**
 * Run a command, mapping a refusal to exit 2 and anything else to exit 1.
 * `onError` adds what the operator most needs to know about state.
 */
export async function runCommand(
  command: () => Promise<void>,
  onError?: (error: Error) => Promise<string | undefined>,
): Promise<void> {
  try {
    await command();
  } catch (error) {
    const e = error as Error;
    const refused = e instanceof RefusalError;
    console.error(`${refused ? 'refused' : 'error'}: ${e.message}`);
    const note = await onError?.(e).catch(() => undefined);
    if (note) console.error(note);
    process.exit(refused ? 2 : 1);
  }
}
