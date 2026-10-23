import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * F4 — every writer of a bill's lifecycle inputs goes through
 * `writeBillLifecycleFields` (`docs/plans/ingestion-resource-lanes.md` §5.1).
 *
 * `isDead` / `isActive` are derived from `status`, `lastAction`,
 * `lastActionDate` and `currentStageId`. A write that changes an input and
 * not the flags leaves the bill mislabelled until something else rewrites
 * it — and once cold bills are frozen (K5), nothing else will. The summary
 * pass and `stage_backfill` both did exactly that.
 *
 * Enforced by reading the source rather than by convention, because the
 * failure is silent: a stale flag looks exactly like a correct one. The
 * extraction upsert writes inputs and flags together through its `billData`
 * object, which it passes by reference — so the scan never sees its fields
 * (see below), and needs no exemption.
 *
 * **What it cannot see:** a field passed through a spread
 * (`data: { ...patch }`). It reads text, so it catches the literal
 * `currentStageId:` that both original offenders used, not every possible
 * write — verified by reintroducing a spread-shaped bypass, which only the
 * behavioural test on `writeStatusSummary` caught. This is the cheap net;
 * the per-writer tests and the `BillNonLifecycleUpdate` type on the writer's
 * `extra` are the real guard. It can also false-positive on a lifecycle field
 * used in a call's `where`; that is the cheaper error, and the message says
 * which call to look at.
 */
const REGION_SRC = join(__dirname, '..');
// The inputs, the flags themselves, and sessionYear (it feeds the
// session-expired rule).
const LIFECYCLE_FIELD =
  /\b(status|lastAction|lastActionDate|currentStageId|sessionYear|isDead|isActive)\s*:/;
const EXEMPT = new Set(['domains/bill-lifecycle-writer.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * The argument of each Prisma write on `bill` (`update`, `updateMany`,
 * `upsert`, `create`, `createMany`), by bracket
 * matching rather than a regex, so a nested object cannot end the match
 * early and hide a field after it.
 */
function billUpdateArguments(source: string): string[] {
  const found: string[] = [];
  // `\s*` lets a call split across lines (`this.db.bill\n  .update(`) match.
  const call =
    /\bbill\s*\.(?:update|updateMany|upsert|create|createMany|createManyAndReturn)\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    found.push(source.slice(m.index + m[0].length, i - 1));
  }
  return found;
}

/** Raw SQL that writes the bills table, which no Prisma-call scan can see. */
const RAW_BILL_WRITE =
  /\$(?:executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)[\s\S]{0,400}?\b(?:UPDATE|INSERT INTO)\s+(?:"?public"?\.)?"?bills"?\b/i;

describe('bill lifecycle writes go through writeBillLifecycleFields (F4)', () => {
  it('no other bill write sets a lifecycle input', () => {
    const offenders = sourceFiles(REGION_SRC).flatMap((file) => {
      const rel = relative(REGION_SRC, file).split(sep).join('/');
      if (EXEMPT.has(rel)) return [];
      return billUpdateArguments(readFileSync(file, 'utf8'))
        .filter((arg) => LIFECYCLE_FIELD.test(arg))
        .map((arg) => `${rel}: ${arg.replace(/\s+/g, ' ').slice(0, 120)}`);
    });

    expect(offenders).toEqual([]);
  });

  it('no raw SQL writes the bills table', () => {
    const offenders = sourceFiles(REGION_SRC)
      .filter((file) => RAW_BILL_WRITE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REGION_SRC, file));

    expect(offenders).toEqual([]);
  });

  it('finds a lifecycle write in an upsert split across lines', () => {
    const args = billUpdateArguments(
      `await this.db.bill\n  .upsert({ where: { id }, create: { status: s }, update: {} });`,
    );

    expect(args).toHaveLength(1);
    expect(LIFECYCLE_FIELD.test(args[0])).toBe(true);
  });

  it('finds raw SQL against a schema-qualified bills table', () => {
    expect(
      RAW_BILL_WRITE.test(
        'await db.$queryRaw`UPDATE "public"."bills" SET status = ${s} RETURNING id`',
      ),
    ).toBe(true);
  });

  it('finds a lifecycle write when one exists', () => {
    // Guards the guard: a scanner that matched nothing would pass forever.
    const args = billUpdateArguments(
      `await this.db.bill.updateMany({ where: { id: { in: ids } }, data: { currentStageId: s } });`,
    );

    expect(args).toHaveLength(1);
    expect(LIFECYCLE_FIELD.test(args[0])).toBe(true);
  });
});
