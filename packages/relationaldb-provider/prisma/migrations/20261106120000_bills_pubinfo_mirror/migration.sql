-- Bills Phase B (docs/plans/bills-phase-b.md D9, D10, B8, F3/K6).
-- Additive only: nine new tables and two nullable columns on bills. No
-- backfill: the first pubinfo import fills the mirrors, and the derive step
-- writes bills from them.
--
-- D10: one mirror per pubinfo table, one row per export line, keyed as the
-- export keys it (external_id is the region config's key column, or its
-- compositeKey joined with ':'). Each carries the line hash the K4 skip
-- compares and the run that wrote it (#1277, #1280). Widths are the source's
-- own declared maxima (pubinfo_load.zip, capublic.sql), not today's lengths.
-- bill_xml holds every version's full text (~666 MB a session, TOAST
-- compressed): the summary reads the current one, and comparing amendments
-- needs the rest.
--
-- Producing-run columns follow 20260918170000_row_producing_run: plain index,
-- ON DELETE SET NULL, never CASCADE.

CREATE TABLE "pubinfo_bills" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(30) NOT NULL,
    "session_year" VARCHAR(8) NOT NULL,
    "measure_type" VARCHAR(4) NOT NULL,
    "measure_num" INTEGER NOT NULL,
    "measure_state" VARCHAR(40),
    "chapter_year" VARCHAR(4),
    "chapter_num" VARCHAR(10),
    "latest_bill_version_id" VARCHAR(30),
    "current_location" VARCHAR(200),
    "current_house" VARCHAR(60),
    "current_status" VARCHAR(60),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_bills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_bills_external_id_key" ON "pubinfo_bills"("external_id");
CREATE INDEX "pubinfo_bills_pipeline_execution_id_idx" ON "pubinfo_bills"("pipeline_execution_id");
ALTER TABLE "pubinfo_bills" ADD CONSTRAINT "pubinfo_bills_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_bill_versions" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(30) NOT NULL,
    "bill_id" VARCHAR(30) NOT NULL,
    "version_num" INTEGER NOT NULL,
    "bill_version_action_date" DATE NOT NULL,
    "bill_version_action" VARCHAR(100),
    "subject" VARCHAR(1000),
    "vote_required" VARCHAR(100),
    "appropriation" VARCHAR(3),
    "fiscal_committee" VARCHAR(3),
    "local_program" VARCHAR(3),
    "urgency" VARCHAR(3),
    "taxlevy" VARCHAR(3),
    "bill_xml" TEXT,
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_bill_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_bill_versions_external_id_key" ON "pubinfo_bill_versions"("external_id");
CREATE INDEX "pubinfo_bill_versions_bill_id_version_num_idx" ON "pubinfo_bill_versions"("bill_id", "version_num");
CREATE INDEX "pubinfo_bill_versions_pipeline_execution_id_idx" ON "pubinfo_bill_versions"("pipeline_execution_id");
ALTER TABLE "pubinfo_bill_versions" ADD CONSTRAINT "pubinfo_bill_versions_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_bill_version_authors" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(400) NOT NULL,
    "bill_version_id" VARCHAR(30) NOT NULL,
    "type" VARCHAR(15) NOT NULL,
    "house" VARCHAR(100),
    "name" VARCHAR(100),
    "contribution" VARCHAR(100),
    "primary_author_flg" VARCHAR(1),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_bill_version_authors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_bill_version_authors_external_id_key" ON "pubinfo_bill_version_authors"("external_id");
CREATE INDEX "pubinfo_bill_version_authors_bill_version_id_idx" ON "pubinfo_bill_version_authors"("bill_version_id");
CREATE INDEX "pubinfo_bill_version_authors_pipeline_execution_id_idx" ON "pubinfo_bill_version_authors"("pipeline_execution_id");
ALTER TABLE "pubinfo_bill_version_authors" ADD CONSTRAINT "pubinfo_bill_version_authors_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_bill_history" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(30) NOT NULL,
    "bill_id" VARCHAR(30) NOT NULL,
    "action_date" DATE,
    "action" TEXT,
    "action_sequence" INTEGER,
    "action_code" VARCHAR(5),
    "action_status" VARCHAR(60),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_bill_history_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_bill_history_external_id_key" ON "pubinfo_bill_history"("external_id");
CREATE INDEX "pubinfo_bill_history_bill_id_action_date_idx" ON "pubinfo_bill_history"("bill_id", "action_date");
CREATE INDEX "pubinfo_bill_history_pipeline_execution_id_idx" ON "pubinfo_bill_history"("pipeline_execution_id");
ALTER TABLE "pubinfo_bill_history" ADD CONSTRAINT "pubinfo_bill_history_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_bill_summary_votes" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(200) NOT NULL,
    "bill_id" VARCHAR(30) NOT NULL,
    "location_code" VARCHAR(6) NOT NULL,
    "vote_date_time" VARCHAR(19) NOT NULL,
    "vote_date_seq" INTEGER NOT NULL,
    "motion_id" INTEGER NOT NULL,
    "ayes" INTEGER,
    "noes" INTEGER,
    "abstain" INTEGER,
    "vote_result" VARCHAR(6),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_bill_summary_votes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_bill_summary_votes_external_id_key" ON "pubinfo_bill_summary_votes"("external_id");
CREATE INDEX "pubinfo_bill_summary_votes_bill_id_idx" ON "pubinfo_bill_summary_votes"("bill_id");
CREATE INDEX "pubinfo_bill_summary_votes_pipeline_execution_id_idx" ON "pubinfo_bill_summary_votes"("pipeline_execution_id");
ALTER TABLE "pubinfo_bill_summary_votes" ADD CONSTRAINT "pubinfo_bill_summary_votes_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_bill_detail_votes" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(250) NOT NULL,
    "bill_id" VARCHAR(30) NOT NULL,
    "location_code" VARCHAR(6) NOT NULL,
    "legislator_name" VARCHAR(50) NOT NULL,
    "vote_date_time" VARCHAR(19) NOT NULL,
    "vote_date_seq" INTEGER NOT NULL,
    "vote_code" VARCHAR(5),
    "motion_id" INTEGER NOT NULL,
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_bill_detail_votes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_bill_detail_votes_external_id_key" ON "pubinfo_bill_detail_votes"("external_id");
CREATE INDEX "pubinfo_bill_detail_votes_bill_id_idx" ON "pubinfo_bill_detail_votes"("bill_id");
CREATE INDEX "pubinfo_bill_detail_votes_pipeline_execution_id_idx" ON "pubinfo_bill_detail_votes"("pipeline_execution_id");
ALTER TABLE "pubinfo_bill_detail_votes" ADD CONSTRAINT "pubinfo_bill_detail_votes_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_bill_motions" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(20) NOT NULL,
    "motion_text" VARCHAR(250),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_bill_motions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_bill_motions_external_id_key" ON "pubinfo_bill_motions"("external_id");
CREATE INDEX "pubinfo_bill_motions_pipeline_execution_id_idx" ON "pubinfo_bill_motions"("pipeline_execution_id");
ALTER TABLE "pubinfo_bill_motions" ADD CONSTRAINT "pubinfo_bill_motions_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_legislators" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(200) NOT NULL,
    "district" VARCHAR(5) NOT NULL,
    "session_year" VARCHAR(8) NOT NULL,
    "legislator_name" VARCHAR(50) NOT NULL,
    "house_type" VARCHAR(1) NOT NULL,
    "author_name" VARCHAR(200),
    "first_name" VARCHAR(30),
    "last_name" VARCHAR(50),
    "party" VARCHAR(4),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_legislators_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_legislators_external_id_key" ON "pubinfo_legislators"("external_id");
CREATE INDEX "pubinfo_legislators_pipeline_execution_id_idx" ON "pubinfo_legislators"("pipeline_execution_id");
ALTER TABLE "pubinfo_legislators" ADD CONSTRAINT "pubinfo_legislators_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pubinfo_location_codes" (
    "id" TEXT NOT NULL,
    "external_id" VARCHAR(40) NOT NULL,
    "session_year" VARCHAR(8) NOT NULL,
    "location_code" VARCHAR(6) NOT NULL,
    "location_type" VARCHAR(1),
    "description" VARCHAR(60),
    "long_description" VARCHAR(200),
    "source_record_hash" VARCHAR(64),
    "pipeline_execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pubinfo_location_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pubinfo_location_codes_external_id_key" ON "pubinfo_location_codes"("external_id");
CREATE INDEX "pubinfo_location_codes_pipeline_execution_id_idx" ON "pubinfo_location_codes"("pipeline_execution_id");
ALTER TABLE "pubinfo_location_codes" ADD CONSTRAINT "pubinfo_location_codes_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- B8 guard: where a bill's status came from. 'official' is a publisher's
-- structured status (pubinfo current_status). NULL is legacy or page-scraped:
-- on 4,486 of 5,019 dev bills an LLM read of the text page, which flipped
-- 2,180 active bills to "passed" when the F4 refresh recomputed from it. The
-- refresh recomputes flags only from an 'official' status.
ALTER TABLE "bills" ADD COLUMN "status_source" VARCHAR(20);

-- F3/K6: the summary's model digest, as reps and committees already record,
-- so a summary can be regenerated when the model changes.
ALTER TABLE "bills" ADD COLUMN "ai_summary_llm_digest" VARCHAR(80);
