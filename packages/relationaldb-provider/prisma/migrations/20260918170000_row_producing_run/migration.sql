-- #1280 — link civic rows to the pipeline run that produced them.
--
-- Additive only: four nullable columns per table, an index on the execution
-- reference, and two foreign keys. Existing rows are left NULL deliberately —
-- a null says "we do not know which run produced this", whereas a back-dated
-- guess would be indistinguishable from a real link.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE "propositions"
    ADD COLUMN "pipeline_execution_id" TEXT,
    ADD COLUMN "manifest_id" TEXT,
    ADD COLUMN "manifest_version" INTEGER;

ALTER TABLE "minutes"
    ADD COLUMN "pipeline_execution_id" TEXT,
    ADD COLUMN "manifest_id" TEXT,
    ADD COLUMN "manifest_version" INTEGER;

ALTER TABLE "bills"
    ADD COLUMN "pipeline_execution_id" TEXT,
    ADD COLUMN "manifest_id" TEXT,
    ADD COLUMN "manifest_version" INTEGER;

-- contributions is ~7.5 GB / 18M rows. Nullable columns with no default are a
-- catalogue-only change in Postgres 11+ — no table rewrite — so this is fast
-- despite the size.
ALTER TABLE "contributions"
    ADD COLUMN "pipeline_execution_id" TEXT,
    ADD COLUMN "manifest_id" TEXT,
    ADD COLUMN "manifest_version" INTEGER;

-- ---------------------------------------------------------------------------
-- Indexes — the acceptance criterion is "given an execution, list its rows"
-- ---------------------------------------------------------------------------

CREATE INDEX "propositions_pipeline_execution_id_idx"
    ON "propositions"("pipeline_execution_id");
CREATE INDEX "minutes_pipeline_execution_id_idx"
    ON "minutes"("pipeline_execution_id");
CREATE INDEX "bills_pipeline_execution_id_idx"
    ON "bills"("pipeline_execution_id");
-- Plain, not CONCURRENTLY and not partial, on a 7.5 GB / 18M-row table —
-- deliberately, and measured rather than assumed:
--
--   * CONCURRENTLY is unavailable. Prisma runs each migration inside a
--     transaction and Postgres rejects it there (SQLSTATE 25001).
--   * A partial index (WHERE pipeline_execution_id IS NOT NULL) would be
--     smaller, but Prisma cannot express a predicate in @@index, so the
--     database would permanently disagree with the model. `migrate diff`
--     then wants to recreate it on every comparison — the #1168 hazard that
--     already cost this project every raw-SQL index in production once.
--   * The cost is small. Building this index against the real 18M-row table
--     took **7 seconds** and produced 119 MB. Migrations run during a deploy,
--     when the service is restarting anyway.
--
-- Seven seconds of blocked writes is the cheaper side of that trade. If the
-- table grows by an order of magnitude, revisit — the answer then is probably
-- an out-of-band CONCURRENTLY build plus `migrate resolve`, not a predicate.
CREATE INDEX "contributions_pipeline_execution_id_idx"
    ON "contributions"("pipeline_execution_id");

-- ---------------------------------------------------------------------------
-- Foreign keys
--
-- ON DELETE SET NULL, never CASCADE: pruning pipeline bookkeeping must not
-- delete civic rows. Losing the pointer is recoverable; losing the row is not.
-- ---------------------------------------------------------------------------

ALTER TABLE "propositions"
    ADD CONSTRAINT "propositions_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "propositions"
    ADD CONSTRAINT "propositions_manifest_id_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "structural_manifests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "minutes"
    ADD CONSTRAINT "minutes_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "minutes"
    ADD CONSTRAINT "minutes_manifest_id_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "structural_manifests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bills"
    ADD CONSTRAINT "bills_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bills"
    ADD CONSTRAINT "bills_manifest_id_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "structural_manifests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- contributions: added NOT VALID first, then validated.
--
-- A plain ADD CONSTRAINT ... FOREIGN KEY scans the whole table to prove every
-- existing row satisfies it, holding a lock that blocks writes for the
-- duration. On 18M rows that is a long outage for a column that is NULL in
-- every one of them. NOT VALID takes the constraint immediately and skips the
-- scan; VALIDATE CONSTRAINT then performs it under a weaker lock that permits
-- concurrent reads and writes. The end state is an ordinary validated foreign
-- key — identical to what Prisma's schema expects, so this produces no drift.
ALTER TABLE "contributions"
    ADD CONSTRAINT "contributions_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "contributions"
    VALIDATE CONSTRAINT "contributions_pipeline_execution_id_fkey";

ALTER TABLE "contributions"
    ADD CONSTRAINT "contributions_manifest_id_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "structural_manifests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "contributions"
    VALIDATE CONSTRAINT "contributions_manifest_id_fkey";
