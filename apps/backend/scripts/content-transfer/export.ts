/**
 * Export locally-regenerated AI content as a transferable bundle (#1305).
 *
 * The expensive half of a model refresh is the inference: ~550 s per measure
 * on `olmo-3.1:32b-instruct`, days across the corpus. Doing it once locally
 * and moving the result beats running it again on a node that shares its
 * Ollama with the nightly cron.
 *
 * What makes that safe rather than hopeful is #1279's binding: every analysis
 * records the hash of the text it was generated against, so the import can
 * refuse any row whose target text differs instead of writing an analysis
 * onto text it never saw.
 *
 * Usage:
 *   DATABASE_URL=… tsx scripts/content-transfer/export.ts --out bundle.json [--label local]
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@opuspopuli/relationaldb-provider';
import type { BundledClaim, ContentBundle } from './bundle';

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * The CURRENT claims for one subject, with their citations.
 *
 * Current only: superseded generations (#1295) are this database's history,
 * not content to replay onto another one. Evidence is read for its citation
 * fields but the verdict is deliberately left behind — the import re-derives
 * it, so what arrives is verified rather than asserted.
 */
async function claimsFor(
  db: PrismaClient,
  subjectType: string,
  subjectId: string,
): Promise<BundledClaim[]> {
  const rows = await db.claim.findMany({
    where: { subjectType, subjectId, validUntil: null },
    include: { evidence: { include: { evidence: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((claim) => {
    const evidence = claim.evidence[0]?.evidence;
    return {
      text: claim.text,
      subjectField: claim.subjectField,
      confidence: claim.confidence,
      spanStart: evidence?.spanStart ?? null,
      spanEnd: evidence?.spanEnd ?? null,
      quotedText: evidence?.quotedText ?? null,
      citationHint: evidence?.citationHint ?? null,
    };
  });
}

/** Columns carrying a proposition's analysis. Named, never selected by prefix. */
const ANALYSIS_COLUMNS = [
  'analysisSummary',
  'keyProvisions',
  'fiscalImpact',
  'yesOutcome',
  'noOutcome',
  'existingVsProposed',
  'analysisSections',
  'analysisClaims',
  'analysisSource',
  'analysisPromptHash',
  'analysisPromptVersion',
  'analysisLlmModel',
  'analysisLlmDigest',
  'analysisSourceTextHash',
  'analysisGeneratedAt',
] as const;

const SUMMARY_COLUMNS = [
  'summary',
  'summaryClaims',
  'summaryPromptHash',
  'summaryPromptVersion',
  'summaryLlmModel',
  'summaryLlmDigest',
] as const;

const BIO_COLUMNS = [
  'bio',
  'bioSource',
  'bioClaims',
  'bioPromptHash',
  'bioPromptVersion',
  'bioLlmModel',
  'bioLlmDigest',
] as const;

const pick = (
  row: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(columns.map((c) => [c, row[c] ?? null]));

async function main(): Promise<void> {
  const out = arg('out');
  if (!out) throw new Error('--out <path> is required');

  const db = new PrismaClient();

  const propositionRows = await db.proposition.findMany({
    // `not: undefined` is a NO-OP: Prisma reads undefined as "no filter",
    // so this returned every row and only the guard below narrowed it —
    // loading full source text for rows that were never going to be exported.
    // `Prisma.DbNull` is the predicate the rest of the codebase already uses.
    where: { analysisClaims: { not: Prisma.DbNull } },
  });
  const propositions = [];
  for (const row of propositionRows) {
    if (!row.analysisClaims) continue;
    propositions.push({
      regionPluginName: row.regionPluginName,
      externalId: row.externalId,
      // Hashed from the text itself rather than read from the generated
      // column, so the bundle does not depend on the source database having
      // #1279's migration applied.
      sourceTextHash: row.fullText ? sha256(row.fullText) : '',
      analysis: pick(
        row as unknown as Record<string, unknown>,
        ANALYSIS_COLUMNS,
      ),
      claims: await claimsFor(db, 'proposition', row.id),
    });
  }

  const minutesRows = await db.minutes.findMany({
    // `not: undefined` is a NO-OP: Prisma reads undefined as "no filter",
    // so this returned every row and only the guard below narrowed it —
    // loading full source text for rows that were never going to be exported.
    // `Prisma.DbNull` is the predicate the rest of the codebase already uses.
    where: { summaryClaims: { not: Prisma.DbNull } },
  });
  const minutes = [];
  for (const row of minutesRows) {
    if (!row.summaryClaims) continue;
    minutes.push({
      externalId: row.externalId,
      sourceTextHash: row.rawText ? sha256(row.rawText) : '',
      summary: pick(row as unknown as Record<string, unknown>, SUMMARY_COLUMNS),
      claims: await claimsFor(db, 'minutes', row.id),
    });
  }

  const repRows = await db.representative.findMany({
    // `not: undefined` is a NO-OP: Prisma reads undefined as "no filter",
    // so this returned every row and only the guard below narrowed it —
    // loading full source text for rows that were never going to be exported.
    // `Prisma.DbNull` is the predicate the rest of the codebase already uses.
    where: { bioClaims: { not: Prisma.DbNull } },
  });
  const representatives = [];
  for (const row of repRows) {
    if (!row.bioClaims) continue;
    representatives.push({
      externalId: row.externalId,
      bio: pick(row as unknown as Record<string, unknown>, BIO_COLUMNS),
      claims: await claimsFor(db, 'representative', row.id),
    });
  }

  const stateRows = await db.evidence.groupBy({
    by: ['state'],
    where: { claims: { some: { claim: { validUntil: null } } } },
    _count: { state: true },
  });

  const promptRows = await db.proposition.groupBy({
    by: ['analysisPromptHash', 'analysisPromptVersion'],
    where: { analysisPromptHash: { not: null } },
    _count: { _all: true },
  });
  const modelRows = await db.proposition.groupBy({
    by: ['analysisLlmModel', 'analysisLlmDigest'],
    where: { analysisLlmModel: { not: null } },
    _count: { _all: true },
  });

  const bundle: ContentBundle = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceLabel: arg('label') ?? 'unlabelled',
    provenance: {
      prompts: promptRows.map((r) => ({
        hash: r.analysisPromptHash as string,
        version: r.analysisPromptVersion,
        count: r._count._all,
      })),
      models: modelRows.map((r) => ({
        model: r.analysisLlmModel as string,
        digest: r.analysisLlmDigest,
        count: r._count._all,
      })),
    },
    distribution: Object.fromEntries(
      stateRows.map((r) => [r.state, r._count.state]),
    ),
    propositions,
    minutes,
    representatives,
  };

  writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(
    `Wrote ${out}: ${propositions.length} propositions, ${minutes.length} minutes, ` +
      `${representatives.length} representatives; distribution ` +
      `${JSON.stringify(bundle.distribution)}`,
  );

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
