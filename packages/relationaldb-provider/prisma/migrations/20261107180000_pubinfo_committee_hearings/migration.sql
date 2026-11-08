-- bills-phase-b.md, D13/D20: a mirror of pubinfo COMMITTEE_HEARING_TBL, one row
-- per export line. Bills' committee referrals are derived from it. A new
-- table only; public legislative data.
CREATE TABLE "pubinfo_committee_hearings" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "bill_id" VARCHAR(30) NOT NULL,
    "committee_type" VARCHAR(2),
    "committee_nr" INTEGER,
    "hearing_date" DATE,
    "location_code" VARCHAR(6) NOT NULL,
    "trans_update_date" VARCHAR(19),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_committee_hearings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_committee_hearings_external_id_key" ON "pubinfo_committee_hearings"("external_id");
CREATE INDEX "pubinfo_committee_hearings_bill_id_idx" ON "pubinfo_committee_hearings"("bill_id");
CREATE INDEX "pubinfo_committee_hearings_pipeline_execution_id_idx" ON "pubinfo_committee_hearings"("pipeline_execution_id");
ALTER TABLE "pubinfo_committee_hearings" ADD CONSTRAINT "pubinfo_committee_hearings_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
