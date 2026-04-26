-- Legislative committees: first-class entity + membership join table.
--
-- Adds:
--   * legislative_committees — committees within a chamber (Senate Judiciary,
--     Assembly Health, etc). NOT campaign-finance committees — that's the
--     separate `committees` table. Populated by the backfill service from
--     Representative.committees JSON.
--   * representative_committee_assignments — many-to-many membership join
--     with canonicalized role (Chair / Vice Chair / Member).
--
-- Migration is fully additive. Existing rows are unaffected; the
-- representatives.committees JSONB column stays as the canonical source for
-- the backfill and remains writable by future scrapes.

-- 1. legislative_committees ------------------------------------------------
CREATE TABLE "legislative_committees" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chamber" VARCHAR(20) NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "legislative_committees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legislative_committees_external_id_key" ON "legislative_committees" ("external_id");
CREATE INDEX "legislative_committees_chamber_idx" ON "legislative_committees" ("chamber");
CREATE INDEX "legislative_committees_name_idx" ON "legislative_committees" ("name");

-- 2. representative_committee_assignments ---------------------------------
CREATE TABLE "representative_committee_assignments" (
    "id" TEXT NOT NULL,
    "representative_id" TEXT NOT NULL,
    "legislative_committee_id" TEXT NOT NULL,
    "role" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "representative_committee_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "representative_committee_assignments_representative_id_legi_key"
    ON "representative_committee_assignments" ("representative_id", "legislative_committee_id");
CREATE INDEX "representative_committee_assignments_legislative_committee__idx"
    ON "representative_committee_assignments" ("legislative_committee_id");

ALTER TABLE "representative_committee_assignments"
    ADD CONSTRAINT "representative_committee_assignments_representative_id_fkey"
    FOREIGN KEY ("representative_id") REFERENCES "representatives" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "representative_committee_assignments"
    ADD CONSTRAINT "representative_committee_assignments_legislative_committe_fkey"
    FOREIGN KEY ("legislative_committee_id") REFERENCES "legislative_committees" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
