-- Add bills, bill_co_authors, bill_committee_assignments, bill_votes tables.
-- All new tables — fully additive, no changes to existing schema. Issue #686.

CREATE TABLE "bills" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "external_id"       TEXT        NOT NULL,
    "region_id"         TEXT        NOT NULL,
    "bill_number"       VARCHAR(30) NOT NULL,
    "session_year"      VARCHAR(10) NOT NULL,
    "measure_type_code" VARCHAR(10) NOT NULL,
    "title"             TEXT        NOT NULL,
    "subject"           VARCHAR(500),
    "status"            VARCHAR(200),
    "current_stage_id"  VARCHAR(100),
    "last_action"       TEXT,
    "last_action_date"  DATE,
    "fiscal_impact"     TEXT,
    "full_text_url"     TEXT,
    "author_id"         UUID,
    "author_name"       VARCHAR(200),
    "source_url"        TEXT        NOT NULL,
    "extracted_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bills_external_id_key"        ON "bills"("external_id");
CREATE INDEX "bills_region_session_idx"            ON "bills"("region_id", "session_year");
CREATE INDEX "bills_region_measure_type_idx"       ON "bills"("region_id", "measure_type_code");
CREATE INDEX "bills_author_id_idx"                 ON "bills"("author_id");
CREATE INDEX "bills_status_idx"                    ON "bills"("status");
CREATE INDEX "bills_last_action_date_idx"          ON "bills"("last_action_date" DESC);

ALTER TABLE "bills"
    ADD CONSTRAINT "bills_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "representatives"("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "bill_co_authors" (
    "bill_id"            UUID         NOT NULL,
    "representative_id"  UUID         NOT NULL,
    "co_author_type"     VARCHAR(50),
    "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "bill_co_authors_pkey" PRIMARY KEY ("bill_id", "representative_id")
);

CREATE INDEX "bill_co_authors_representative_id_idx" ON "bill_co_authors"("representative_id");

ALTER TABLE "bill_co_authors"
    ADD CONSTRAINT "bill_co_authors_bill_id_fkey"
    FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE;

ALTER TABLE "bill_co_authors"
    ADD CONSTRAINT "bill_co_authors_representative_id_fkey"
    FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "bill_committee_assignments" (
    "bill_id"                    UUID         NOT NULL,
    "legislative_committee_id"   UUID         NOT NULL,
    "referred_at"                DATE,
    "created_at"                 TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "bill_committee_assignments_pkey" PRIMARY KEY ("bill_id", "legislative_committee_id")
);

CREATE INDEX "bill_committee_assignments_committee_id_idx"
    ON "bill_committee_assignments"("legislative_committee_id");

ALTER TABLE "bill_committee_assignments"
    ADD CONSTRAINT "bill_committee_assignments_bill_id_fkey"
    FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE;

ALTER TABLE "bill_committee_assignments"
    ADD CONSTRAINT "bill_committee_assignments_committee_id_fkey"
    FOREIGN KEY ("legislative_committee_id") REFERENCES "legislative_committees"("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "bill_votes" (
    "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    "bill_id"             UUID         NOT NULL,
    "representative_id"   UUID,
    "representative_name" VARCHAR(200) NOT NULL,
    "chamber"             VARCHAR(20)  NOT NULL,
    "vote_date"           DATE         NOT NULL,
    "position"            VARCHAR(20)  NOT NULL,
    "motion_text"         VARCHAR(200),
    "source_url"          TEXT         NOT NULL,
    "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "bill_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bill_votes_bill_rep_date_chamber_key"
    ON "bill_votes"("bill_id", "representative_id", "vote_date", "chamber")
    WHERE "representative_id" IS NOT NULL;

CREATE INDEX "bill_votes_bill_id_idx"                  ON "bill_votes"("bill_id");
CREATE INDEX "bill_votes_representative_vote_date_idx"  ON "bill_votes"("representative_id", "vote_date" DESC);
CREATE INDEX "bill_votes_vote_date_idx"                 ON "bill_votes"("vote_date" DESC);

ALTER TABLE "bill_votes"
    ADD CONSTRAINT "bill_votes_bill_id_fkey"
    FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE;

ALTER TABLE "bill_votes"
    ADD CONSTRAINT "bill_votes_representative_id_fkey"
    FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE SET NULL;
