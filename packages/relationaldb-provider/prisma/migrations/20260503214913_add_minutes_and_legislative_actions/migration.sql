-- Issue #665: Meeting minutes / journal documents (`minutes`) and the
-- per-action records extracted from them (`legislative_actions`).
--
-- The `minutes` table stores chamber daily journals and committee
-- hearing minutes as opaque text + audit metadata. Downstream passes
-- (the legislative-action linker for V1, AI summarization for V2) mine
-- the rawText to produce structured records. Optional FKs to
-- `legislative_committees` (per-committee minutes) and `meetings`
-- (when the document corresponds to a calendared meeting).
--
-- `legislative_actions` carries char-offset references back into the
-- parent Minutes' rawText (`passage_start` / `passage_end`) so the
-- citizen-facing "letter to my rep with quoted action" feature can
-- pull the verbatim passage out of the source.

CREATE TABLE "minutes" (
    "id"             TEXT        NOT NULL,
    "external_id"    TEXT        NOT NULL,
    "body"           VARCHAR(20) NOT NULL,
    "date"           DATE        NOT NULL,
    "revision_seq"   INTEGER     NOT NULL DEFAULT 0,
    "is_active"      BOOLEAN     NOT NULL DEFAULT true,
    "committee_id"   TEXT,
    "meeting_id"     TEXT,
    "page_count"     INTEGER,
    "source_url"     TEXT        NOT NULL,
    "raw_text"       TEXT,
    "summary"        TEXT,
    "summary_claims" JSONB,
    "parsed_at"      TIMESTAMPTZ,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "minutes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "minutes_external_id_key"               ON "minutes"("external_id");
CREATE INDEX        "minutes_date_idx"                      ON "minutes"("date" DESC);
CREATE INDEX        "minutes_body_date_idx"                 ON "minutes"("body", "date" DESC);
CREATE INDEX        "minutes_committee_id_date_idx"         ON "minutes"("committee_id", "date" DESC);
CREATE INDEX        "minutes_meeting_id_idx"                ON "minutes"("meeting_id");
CREATE INDEX        "minutes_is_active_idx"                 ON "minutes"("is_active");

ALTER TABLE "minutes"
    ADD CONSTRAINT "minutes_committee_id_fkey"
    FOREIGN KEY ("committee_id") REFERENCES "legislative_committees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "minutes"
    ADD CONSTRAINT "minutes_meeting_id_fkey"
    FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;


CREATE TABLE "legislative_actions" (
    "id"                TEXT        NOT NULL,
    "external_id"       TEXT        NOT NULL,
    "minutes_id"        TEXT        NOT NULL,
    "body"              VARCHAR(20) NOT NULL,
    "date"              DATE        NOT NULL,
    "action_type"       VARCHAR(40) NOT NULL,
    "representative_id" TEXT,
    "proposition_id"    TEXT,
    "committee_id"      TEXT,
    "position"          VARCHAR(20),
    "text"              TEXT,
    "summary"           TEXT,
    "passage_start"     INTEGER,
    "passage_end"       INTEGER,
    "source_page"       INTEGER,
    "raw_subject"       VARCHAR(500),
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legislative_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legislative_actions_external_id_key"          ON "legislative_actions"("external_id");
CREATE INDEX        "legislative_actions_minutes_id_idx"           ON "legislative_actions"("minutes_id");
CREATE INDEX        "legislative_actions_rep_date_idx"             ON "legislative_actions"("representative_id", "date" DESC);
CREATE INDEX        "legislative_actions_proposition_date_idx"     ON "legislative_actions"("proposition_id", "date" DESC);
CREATE INDEX        "legislative_actions_committee_date_idx"       ON "legislative_actions"("committee_id", "date" DESC);
CREATE INDEX        "legislative_actions_body_date_idx"            ON "legislative_actions"("body", "date" DESC);
CREATE INDEX        "legislative_actions_action_type_idx"          ON "legislative_actions"("action_type");

ALTER TABLE "legislative_actions"
    ADD CONSTRAINT "legislative_actions_minutes_id_fkey"
    FOREIGN KEY ("minutes_id") REFERENCES "minutes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legislative_actions"
    ADD CONSTRAINT "legislative_actions_representative_id_fkey"
    FOREIGN KEY ("representative_id") REFERENCES "representatives"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legislative_actions"
    ADD CONSTRAINT "legislative_actions_proposition_id_fkey"
    FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legislative_actions"
    ADD CONSTRAINT "legislative_actions_committee_id_fkey"
    FOREIGN KEY ("committee_id") REFERENCES "legislative_committees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;


-- Watermark for cold-start protection on listing-walk sources (daily
-- journals etc.). One row per (region, source_url, data_type) tracks
-- the most recently ingested item so subsequent syncs can stop at the
-- watermark instead of re-walking historical archives.
CREATE TABLE "ingestion_watermarks" (
    "id"               TEXT          NOT NULL,
    "region_id"        VARCHAR(100)  NOT NULL,
    "source_url"       VARCHAR(1000) NOT NULL,
    "data_type"        VARCHAR(50)   NOT NULL,
    "last_external_id" VARCHAR(255),
    "last_ingested_at" TIMESTAMPTZ,
    "items_ingested"   INTEGER       NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_watermarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ingestion_watermarks_region_source_type_key"
    ON "ingestion_watermarks"("region_id", "source_url", "data_type");
