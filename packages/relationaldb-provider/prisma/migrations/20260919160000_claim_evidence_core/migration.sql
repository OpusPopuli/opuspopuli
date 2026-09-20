-- #1291 — Claim and Evidence as first-class rows (epic #1208, M2).
--
-- Additive only: four new tables and two new enums. Nothing existing is
-- touched, and nothing reads this model as authoritative yet. The three JSONB
-- claim columns remain the write-side cache until the cutover (#1293/#1294).
--
-- No claim is written by this migration. Claims acquire an evidence state only
-- by passing through the verifier (#1292) — importing today's offsets directly
-- would launder unverified assertions into a table called "evidence", which is
-- the failure this architecture exists to prevent. Measured: the write path
-- clamps offsets into range, so 528/528 stored spans are "in range" by
-- construction, while #1212 measured ~2% actually anchored on this contract.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- No default and no "assumed verified". `unsourced` is not a failed check — it
-- is a claim that never carried a citation, which bio_claims' origin:'training'
-- records today and which must stay distinguishable from one that failed.
CREATE TYPE "evidence_state" AS ENUM ('verified', 'snapped', 'unverified', 'unsourced');

CREATE TYPE "claim_relation_kind" AS ENUM ('supports', 'contradicts', 'qualifies', 'supersedes');

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    -- Polymorphic subject: the three claim families live in different tables,
    -- so this is deliberately not a foreign key. Four nullable FK columns or a
    -- constraint Prisma cannot express are both worse than an indexed pair.
    "subject_type" VARCHAR(50) NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_field" VARCHAR(100),
    "text" TEXT NOT NULL,
    -- The model's own confidence where it reported one. Recorded, never used
    -- as a substitute for verification.
    "confidence" DOUBLE PRECISION,
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "claims_subject_type_subject_id_idx" ON "claims"("subject_type", "subject_id");
CREATE INDEX "claims_pipeline_execution_id_idx" ON "claims"("pipeline_execution_id");

-- ON DELETE SET NULL, not CASCADE: pruning pipeline bookkeeping must never
-- delete the claims that run produced.
ALTER TABLE "claims"
    ADD CONSTRAINT "claims_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Evidence
--
-- Two references, both nullable for stated reasons:
--   source_version_id — the immutable fetched bytes. NULL for every claim that
--     exists today, because the archive only began filling this cycle. NULL
--     means "predates archiving", not "source unknown".
--   source_text_hash  — SHA-256 of the DERIVED text the span indexes into. A
--     character offset into propositions.full_text is not an offset into the
--     archived HTML, so a span needs the identity of the text it was measured
--     against. Read-time resolution verifies this before slicing; a mismatch
--     means the text changed and the evidence is stale.
-- ---------------------------------------------------------------------------

CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "source_version_id" TEXT,
    "source_text_hash" VARCHAR(64),
    "span_start" INTEGER,
    "span_end" INTEGER,
    -- What the generator quoted, where it quoted rather than pointed (#1212).
    -- Kept so a span can be re-located if surrounding text shifts; never
    -- rendered in place of the live slice.
    "quoted_text" TEXT,
    "state" "evidence_state" NOT NULL,
    -- For sources that never carried offsets (minutes.summary_claims.citation).
    "citation_hint" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "evidence_source_version_id_idx" ON "evidence"("source_version_id");
CREATE INDEX "evidence_source_text_hash_idx" ON "evidence"("source_text_hash");
-- The query this epic exists to answer filters on state.
CREATE INDEX "evidence_state_idx" ON "evidence"("state");

-- ON DELETE SET NULL: an archived source may be pruned by the bulk tier's
-- retention schedule (#1277) while the citation that referenced it remains
-- meaningful through its text hash.
ALTER TABLE "evidence"
    ADD CONSTRAINT "evidence_source_version_id_fkey"
    FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Join and relations
-- ---------------------------------------------------------------------------

CREATE TABLE "claim_evidence" (
    "claim_id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_evidence_pkey" PRIMARY KEY ("claim_id", "evidence_id")
);

CREATE INDEX "claim_evidence_evidence_id_idx" ON "claim_evidence"("evidence_id");

-- CASCADE here, unlike the FKs above: a join row has no meaning without both
-- ends, and orphaning it would leave the graph lying about what cites what.
ALTER TABLE "claim_evidence"
    ADD CONSTRAINT "claim_evidence_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "claims"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "claim_evidence"
    ADD CONSTRAINT "claim_evidence_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "claim_relations" (
    "id" TEXT NOT NULL,
    "from_claim_id" TEXT NOT NULL,
    "to_claim_id" TEXT NOT NULL,
    "kind" "claim_relation_kind" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_relations_pkey" PRIMARY KEY ("id")
);

-- One edge of a given kind between two claims: a second identical assertion is
-- not new information.
CREATE UNIQUE INDEX "claim_relations_from_claim_id_to_claim_id_kind_key"
    ON "claim_relations"("from_claim_id", "to_claim_id", "kind");
CREATE INDEX "claim_relations_to_claim_id_idx" ON "claim_relations"("to_claim_id");

ALTER TABLE "claim_relations"
    ADD CONSTRAINT "claim_relations_from_claim_id_fkey"
    FOREIGN KEY ("from_claim_id") REFERENCES "claims"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "claim_relations"
    ADD CONSTRAINT "claim_relations_to_claim_id_fkey"
    FOREIGN KEY ("to_claim_id") REFERENCES "claims"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
