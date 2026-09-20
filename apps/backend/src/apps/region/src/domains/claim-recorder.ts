import { randomUUID } from 'node:crypto';
import { Prisma, type DbService } from '@opuspopuli/relationaldb-provider';
import type { ClaimRecordInput, ClaimRecordOutcome } from './claim-normalisers';
import { type VerifiedState, verifyEvidence } from './evidence-verifier';

/** One claim reduced to what decides whether it is the same assertion. */
type ClaimSignature = readonly [
  text: string,
  subjectField: string | null,
  confidence: string | null,
  state: string,
  spanStart: number | null,
  spanEnd: number | null,
  quotedText: string | null,
  citationHint: string | null,
];

/**
 * A stable signature for a whole generation's claims.
 *
 * Sorted, because claim order is the model's and carries no meaning — a
 * reordered but otherwise identical generation is not a new assertion about
 * anything, and treating it as one would supersede the corpus on every run.
 *
 * The verdict `state` is part of the signature on purpose: the same claim text
 * checked against rewritten source text is a genuinely different assertion
 * about the evidence, and must be retained as one.
 */
function signature(claims: readonly ClaimSignature[]): string {
  // Each tuple stringified ONCE, then the strings sorted. Sorting the tuples
  // with a JSON-stringifying comparator re-serialised every element on every
  // comparison, and its comparator never returned 0 for equals — harmless
  // here because equal elements are interchangeable, but not worth keeping.
  return JSON.stringify(claims.map((c) => JSON.stringify(c)).sort());
}

/** Signature of what is currently stored for a subject. */
function signatureOf(
  current: readonly {
    text: string;
    subjectField: string | null;
    confidence: string | null;
    evidence: readonly {
      evidence: {
        state: string;
        spanStart: number | null;
        spanEnd: number | null;
        quotedText: string | null;
        citationHint: string | null;
      };
    }[];
  }[],
): string {
  // EVERY evidence row, not just the first. `claim_evidence` is many-to-many
  // and a claim may come to carry several citations; reading only `[0]` would
  // make a change to any of the others invisible, so a genuine regeneration
  // would be mistaken for a no-op and that generation lost.
  return signature(
    current.flatMap((c) =>
      (c.evidence.length > 0
        ? c.evidence.map((link) => link.evidence)
        : [null]
      ).map(
        (e) =>
          [
            c.text,
            c.subjectField,
            c.confidence,
            e?.state ?? '',
            e?.spanStart ?? null,
            e?.spanEnd ?? null,
            e?.quotedText ?? null,
            e?.citationHint ?? null,
          ] as ClaimSignature,
      ),
    ),
  );
}

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

  const incomingSignature = signature(
    verdicts.map(({ claim, outcome }) => [
      claim.text,
      claim.subjectField,
      claim.confidence,
      outcome.state,
      outcome.correctedSpan?.start ?? claim.citation.spanStart,
      outcome.correctedSpan?.end ?? claim.citation.spanEnd,
      claim.citation.quotedText,
      claim.citation.citationHint,
    ]),
  );

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

    // What is current for this subject, with enough of each citation to tell
    // whether the incoming generation actually says anything different.
    const current = await tx.claim.findMany({
      where: { subjectType, subjectId, validUntil: null },
      select: {
        id: true,
        text: true,
        subjectField: true,
        confidence: true,
        evidence: {
          select: {
            evidence: {
              select: {
                state: true,
                spanStart: true,
                spanEnd: true,
                quotedText: true,
                citationHint: true,
              },
            },
          },
        },
      },
    });

    // A regeneration that produced the same claims is not a new generation.
    // Superseding on every call would pile up a dead generation each time the
    // backfill is re-run and break its idempotency, while comparing content
    // keeps the property that matters — a genuine change is retained, a
    // no-change run costs nothing.
    if (signatureOf(current) === incomingSignature) return;

    if (current.length > 0) {
      // Superseded, not deleted. Deleting would make run N impossible to
      // compare with run N-1, which is the entire point of iterating on a
      // model — and would erase what we asserted about a measure last month.
      // Their evidence is retained with them: it is the record of what that
      // generation actually cited.
      await tx.claim.updateMany({
        where: { id: { in: current.map((c) => c.id) } },
        data: { validUntil: new Date() },
      });
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
        // The hash of the text `spanStart`/`spanEnd` index into — which is
        // the CURRENT text, since that is what the span was resolved against.
        // Not `citedHash`: a backfilled claim often has no recorded cited
        // version (#1279's column post-dates it), and storing NULL there would
        // leave offsets with nothing to say which text they address — losing
        // the very binding this column exists for, and making a later rewrite
        // undetectable all over again.
        sourceTextHash: input.sourceTextHash,
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
