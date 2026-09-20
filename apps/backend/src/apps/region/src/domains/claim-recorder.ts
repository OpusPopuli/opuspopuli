import { randomUUID } from 'node:crypto';
import { Prisma, type DbService } from '@opuspopuli/relationaldb-provider';
import type { ClaimRecordInput, ClaimRecordOutcome } from './claim-normalisers';
import { type VerifiedState, verifyEvidence } from './evidence-verifier';

/**
 * Mirror a generator's claims into the relational evidence model (#1293).
 *
 * Every citation passes through {@link verifyEvidence} — the schema gives
 * `evidence.state` no default precisely so that importing a citation without
 * checking it is impossible. Writing claims straight in would launder
 * unverified assertions into a table called `evidence`, which is the failure
 * the evidence graph exists to prevent.
 *
 * Replaces rather than appends: regenerating an analysis must not leave the
 * superseded claims sitting alongside the new ones, indistinguishable and
 * both apparently current. The delete and the insert share one transaction so
 * a failure mid-write cannot leave a subject with no claims at all.
 *
 * @returns How many claims were written, and the verdict distribution
 */
export async function recordClaims(
  db: DbService,
  input: ClaimRecordInput,
): Promise<ClaimRecordOutcome> {
  const { subjectType, subjectId } = input;
  const byState: Partial<Record<VerifiedState, number>> = {};

  // What the claim cited, which is the current text unless a caller says
  // otherwise — see `claimSourceTextHash`.
  const citedHash = input.claimSourceTextHash ?? input.sourceTextHash;

  const verdicts = input.claims.map((claim) => ({
    claim,
    outcome: verifyEvidence(
      claim.text,
      {
        sourceTextHash: citedHash,
        spanStart: claim.citation.spanStart,
        spanEnd: claim.citation.spanEnd,
        quotedText: claim.citation.quotedText,
        citationHint: claim.citation.citationHint,
      },
      input.sourceText,
      input.sourceTextHash,
    ),
  }));

  // Annotated rather than inferred: the inferred transaction-client type
  // names Prisma's runtime library through a nested `node_modules` path, which
  // TypeScript then cannot write into declaration output (TS2742/TS4053) —
  // surfacing as errors in unrelated files that merely share the program.
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // Serialise regenerations of ONE subject against each other. Without this,
    // two writers under READ COMMITTED both read the same stale id set, one
    // delete wins, and both inserts land — leaving the subject with two
    // complete sets of claims, indistinguishable and both apparently current.
    //
    // The realistic collision is #1294's backfill sweeping a family while a
    // generator regenerates a row inside it. A transaction-scoped advisory
    // lock releases on commit or rollback, needs no schema, and does not block
    // writers working on any other subject.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${subjectType}:${subjectId}`}, 0))
    `;

    const existing = await tx.claim.findMany({
      where: { subjectType, subjectId },
      select: { id: true },
    });
    const staleIds = existing.map((c) => c.id);

    if (staleIds.length > 0) {
      // Evidence is joined through `claim_evidence` and has no foreign key
      // back to a claim, so cascading the claim delete clears the join rows
      // and strands the evidence. Collect the ids before the join goes away.
      const links = await tx.claimEvidence.findMany({
        where: { claimId: { in: staleIds } },
        select: { evidenceId: true },
      });
      await tx.claim.deleteMany({ where: { id: { in: staleIds } } });
      const evidenceIds = links.map((l) => l.evidenceId);
      if (evidenceIds.length > 0) {
        // Only what nothing else still cites. `claim_evidence` is many-to-many,
        // so an unconditional delete here would take evidence out from under
        // another subject's claim the moment anything starts sharing rows —
        // which dedup across claims (#1294 onward) is likely to do.
        await tx.evidence.deleteMany({
          where: { id: { in: evidenceIds }, claims: { none: {} } },
        });
      }
    }

    // Three statements regardless of claim count, rather than three per
    // claim. Ids are minted here rather than read back so the join never has
    // to assume `createMany` returned rows in the order they were given.
    const rows = verdicts.map(({ claim, outcome }) => {
      byState[outcome.state] = (byState[outcome.state] ?? 0) + 1;
      return {
        claimId: randomUUID(),
        evidenceId: randomUUID(),
        claim,
        outcome,
      };
    });

    if (rows.length === 0) return;

    await tx.claim.createMany({
      data: rows.map(({ claimId, claim }) => ({
        id: claimId,
        subjectType,
        subjectId,
        subjectField: claim.subjectField,
        text: claim.text,
        confidence: claim.confidence,
        pipelineExecutionId: input.pipelineExecutionId ?? null,
      })),
    });

    await tx.evidence.createMany({
      data: rows.map(({ evidenceId, claim, outcome }) => ({
        id: evidenceId,
        // The text version this verdict was reached against, so a later
        // rewrite of the source is detectable rather than silent (#1279).
        sourceTextHash: citedHash,
        // A located quote carries the offsets it was actually found at —
        // derived under #1212's contract when none were stored, corrected
        // when the stored ones pointed elsewhere. The state says which.
        spanStart: outcome.correctedSpan?.start ?? claim.citation.spanStart,
        spanEnd: outcome.correctedSpan?.end ?? claim.citation.spanEnd,
        quotedText: claim.citation.quotedText,
        citationHint: claim.citation.citationHint,
        state: outcome.state,
      })),
    });

    await tx.claimEvidence.createMany({
      data: rows.map(({ claimId, evidenceId }) => ({ claimId, evidenceId })),
    });
  });

  return { written: verdicts.length, byState };
}
