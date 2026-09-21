/**
 * Apply a content bundle to another database (#1305).
 *
 * ## Dry-run by default
 *
 * This is the only tool that writes production content from a developer's
 * machine. It reports what it would do and changes nothing unless `--apply`
 * is passed.
 *
 * ## Evidence is re-derived, never copied
 *
 * The bundle carries claim CONTENT. Evidence is rebuilt here by the same
 * `recordClaims` the generators use, which re-runs the verify-or-snap gate
 * against THIS database's text — and the resulting distribution is compared
 * against the bundle's. Copied verdicts would be trusted; re-derived ones are
 * verified, and a mismatch means something is wrong rather than something is
 * different.
 *
 * ## Fail-closed
 *
 * A row whose target source text hashes differently is REFUSED and named: the
 * analysis does not belong to that text, and writing it anyway would quote a
 * source as saying something it may never have said. A row absent from the
 * target is refused too — creating civic rows is sync's job. Content the
 * target has and the bundle lacks is left alone; absence here means "no
 * opinion", not "delete".
 *
 * Usage:
 *   DATABASE_URL=… ts-node scripts/content-transfer/import.ts --in bundle.json [--apply]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  PrismaClient,
  type DbService,
  type Prisma,
} from '@opuspopuli/relationaldb-provider';
import { recordClaims } from '../../src/apps/region/src/domains/claim-recorder';
import type { NormalisedClaim } from '../../src/apps/region/src/domains/claim-normalisers';
import type { BundledClaim, ContentBundle } from './bundle';

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Why a row was not applied. Every one is reported, never silent. */
interface Refusal {
  subject: string;
  key: string;
  reason: 'missing-on-target' | 'source-text-differs' | 'no-source-text';
  detail?: string;
}

const toNormalised = (c: BundledClaim): NormalisedClaim => ({
  text: c.text,
  subjectField: c.subjectField,
  confidence: c.confidence,
  citation: {
    spanStart: c.spanStart,
    spanEnd: c.spanEnd,
    quotedText: c.quotedText,
    citationHint: c.citationHint,
  },
});

async function main(): Promise<void> {
  const input = arg('in');
  if (!input) throw new Error('--in <bundle.json> is required');
  const apply = process.argv.includes('--apply');

  const bundle: ContentBundle = JSON.parse(readFileSync(input, 'utf8'));
  if (bundle.formatVersion !== 1) {
    throw new Error(
      `Unsupported bundle formatVersion ${bundle.formatVersion}; expected 1`,
    );
  }

  const db = new PrismaClient();

  // The evidence graph has to exist before anything can be applied. Without
  // this the first write fails deep inside a transaction with a Prisma error
  // rather than saying the target is simply not migrated yet.
  const [{ present }] = await db.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('public.claims') IS NOT NULL AS present
  `;
  if (!present) {
    throw new Error(
      'Target has no `claims` table — it is not migrated to the evidence ' +
        'graph yet (#1291). Deploy the migrations before transferring.',
    );
  }

  const refusals: Refusal[] = [];
  const planned: (() => Promise<void>)[] = [];
  let applied = 0;

  // ── propositions ───────────────────────────────────────────────────────
  for (const p of bundle.propositions) {
    const key = `${p.regionPluginName}/${p.externalId}`;
    const row = await db.proposition.findFirst({
      where: {
        regionPluginName: p.regionPluginName,
        externalId: p.externalId,
      },
      select: { id: true, fullText: true },
    });

    if (!row) {
      refusals.push({
        subject: 'proposition',
        key,
        reason: 'missing-on-target',
      });
      continue;
    }
    if (!row.fullText) {
      refusals.push({ subject: 'proposition', key, reason: 'no-source-text' });
      continue;
    }
    const targetHash = sha256(row.fullText);
    if (targetHash !== p.sourceTextHash) {
      refusals.push({
        subject: 'proposition',
        key,
        reason: 'source-text-differs',
        detail: `bundle ${p.sourceTextHash.slice(0, 12)}… target ${targetHash.slice(0, 12)}…`,
      });
      continue;
    }

    planned.push(async () => {
      await db.proposition.update({
        where: { id: row.id },
        data: p.analysis as Prisma.PropositionUpdateInput,
      });
      await recordClaims(db as unknown as DbService, {
        subjectType: 'proposition',
        subjectId: row.id,
        claims: p.claims.map(toNormalised),
        sourceText: row.fullText,
        sourceTextHash: targetHash,
      });
      applied += 1;
    });
  }

  // ── minutes ────────────────────────────────────────────────────────────
  for (const m of bundle.minutes) {
    const row = await db.minutes.findUnique({
      where: { externalId: m.externalId },
      select: { id: true, rawText: true },
    });

    if (!row) {
      refusals.push({
        subject: 'minutes',
        key: m.externalId,
        reason: 'missing-on-target',
      });
      continue;
    }
    if (!row.rawText) {
      refusals.push({
        subject: 'minutes',
        key: m.externalId,
        reason: 'no-source-text',
      });
      continue;
    }
    const targetHash = sha256(row.rawText);
    if (targetHash !== m.sourceTextHash) {
      refusals.push({
        subject: 'minutes',
        key: m.externalId,
        reason: 'source-text-differs',
        detail: `bundle ${m.sourceTextHash.slice(0, 12)}… target ${targetHash.slice(0, 12)}…`,
      });
      continue;
    }

    planned.push(async () => {
      await db.minutes.update({
        where: { id: row.id },
        data: m.summary as Prisma.MinutesUpdateInput,
      });
      await recordClaims(db as unknown as DbService, {
        subjectType: 'minutes',
        subjectId: row.id,
        claims: m.claims.map(toNormalised),
        sourceText: row.rawText,
        sourceTextHash: targetHash,
      });
      applied += 1;
    });
  }

  // ── representatives ────────────────────────────────────────────────────
  // No source text: bio claims cite structured fields, so there is nothing to
  // hash and nothing to refuse on. Existence is the only precondition.
  for (const r of bundle.representatives) {
    const row = await db.representative.findUnique({
      where: { externalId: r.externalId },
      select: { id: true },
    });

    if (!row) {
      refusals.push({
        subject: 'representative',
        key: r.externalId,
        reason: 'missing-on-target',
      });
      continue;
    }

    planned.push(async () => {
      await db.representative.update({
        where: { id: row.id },
        data: r.bio as Prisma.RepresentativeUpdateInput,
      });
      await recordClaims(db as unknown as DbService, {
        subjectType: 'representative',
        subjectId: row.id,
        claims: r.claims.map(toNormalised),
        sourceText: null,
        sourceTextHash: null,
      });
      applied += 1;
    });
  }

  // ── report before writing ──────────────────────────────────────────────
  const total =
    bundle.propositions.length +
    bundle.minutes.length +
    bundle.representatives.length;
  console.log(
    `Bundle ${input} from "${bundle.sourceLabel}" exported ${bundle.exportedAt}`,
  );
  console.log(
    `  ${total} subjects; ${planned.length} applicable, ${refusals.length} refused`,
  );
  for (const r of refusals) {
    console.log(
      `  REFUSED ${r.subject} ${r.key}: ${r.reason}${r.detail ? ` (${r.detail})` : ''}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Pass --apply to write.');
    await db.$disconnect();
    // `exitCode` rather than `exit()`: process.exit can truncate buffered
    // stdout, and the refusal list is the whole point of a dry run.
    process.exitCode = refusals.length > 0 ? 2 : 0;
    return;
  }

  // Applied per subject rather than inside one transaction over all 226.
  //
  // The plan said single transaction; that was wrong for this shape. A
  // transaction spanning every subject holds `recordClaims`' per-subject
  // advisory locks for its whole duration, blocking any generator touching
  // those rows for minutes — and Prisma cannot nest the interactive
  // transaction `recordClaims` opens inside an outer one anyway.
  //
  // What makes per-subject safe is that the transfer is IDEMPOTENT: a run
  // that dies at subject 40 is repaired by running it again, because the blob
  // upsert is a write of the same values and `recordClaims` no-ops on
  // unchanged content (#1295). Failures are counted and named so a partial
  // run cannot be mistaken for a clean one.
  const failures: string[] = [];
  for (const step of planned) {
    try {
      await step();
    } catch (error) {
      failures.push((error as Error).message);
      console.error(`  FAILED: ${(error as Error).message}`);
    }
  }

  // ── the verification that makes re-derivation worth more than copying ──
  const stateRows = await db.evidence.groupBy({
    by: ['state'],
    where: { claims: { some: { claim: { validUntil: null } } } },
    _count: { state: true },
  });
  const after = Object.fromEntries(
    stateRows.map((r) => [r.state, r._count.state]),
  );

  console.log(`\nApplied ${applied} subjects.`);
  if (failures.length > 0) {
    console.log(
      `  ${failures.length} subject(s) FAILED mid-apply. The transfer is ` +
        `idempotent — re-run to resume; already-applied subjects are no-ops.`,
    );
  }
  console.log(`  bundle distribution: ${JSON.stringify(bundle.distribution)}`);
  console.log(`  target distribution: ${JSON.stringify(after)}`);

  // Only comparable when the whole bundle applied. A partial transfer
  // legitimately produces a different total, and asserting equality there
  // would cry wolf on the one run where refusals were expected.
  if (refusals.length > 0) {
    console.log(
      '  distribution NOT asserted: a partial transfer legitimately produces ' +
        'a different total, and asserting equality here would cry wolf on the ' +
        'one run where refusals were expected.',
    );
  }

  if (refusals.length === 0 && failures.length === 0) {
    const same =
      JSON.stringify(Object.entries(after).sort()) ===
      JSON.stringify(Object.entries(bundle.distribution).sort());
    if (!same) {
      throw new Error(
        'Re-derived verdicts do not match the bundle. The gate reached a ' +
          'different conclusion against this database, which means the ' +
          'content and the text have diverged — refusing rather than leaving ' +
          'a corpus whose evidence nobody can account for.',
      );
    }
    console.log(
      '  distribution matches — re-derived verdicts agree with the source.',
    );
  }

  await db.$disconnect();
  process.exitCode = refusals.length > 0 || failures.length > 0 ? 2 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
