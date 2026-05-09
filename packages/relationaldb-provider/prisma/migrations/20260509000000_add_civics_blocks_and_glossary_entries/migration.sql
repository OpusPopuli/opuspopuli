-- Issue #669: Civic-context extraction tables.
--
-- `civics_blocks` stores partial CivicsBlock JSON extracted from each
-- crawled government page (one row per region+sourceUrl). Consumers
-- merge across rows for a complete view of a region's civic structure.
--
-- `glossary_entries` is a denormalized fast-lookup store flattened from
-- civics_blocks.glossary[] — one row per (regionId, slug) for the
-- <CivicTerm> tooltip feature (#678). Last-write-wins on re-extraction.

CREATE TABLE "civics_blocks" (
    "id"               TEXT         NOT NULL,
    "region_id"        TEXT         NOT NULL,
    "source_url"       TEXT         NOT NULL,
    "chambers"         JSONB,
    "measure_types"    JSONB,
    "lifecycle_stages" JSONB,
    "session_scheme"   JSONB,
    "glossary"         JSONB,
    "prompt_hash"      VARCHAR(64),
    "prompt_version"   VARCHAR(20),
    "llm_model"        VARCHAR(80),
    "extracted_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "civics_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "civics_blocks_region_id_source_url_key"
    ON "civics_blocks"("region_id", "source_url");

CREATE INDEX "civics_blocks_region_id_idx"
    ON "civics_blocks"("region_id");

CREATE TABLE "glossary_entries" (
    "id"               TEXT         NOT NULL,
    "region_id"        TEXT         NOT NULL,
    "term"             TEXT         NOT NULL,
    "slug"             TEXT         NOT NULL,
    "definition"       JSONB        NOT NULL,
    "long_definition"  JSONB,
    "related_terms"    TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source_url"       TEXT         NOT NULL,
    "prompt_hash"      VARCHAR(64),
    "prompt_version"   VARCHAR(20),
    "extracted_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "glossary_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "glossary_entries_region_id_slug_key"
    ON "glossary_entries"("region_id", "slug");

CREATE INDEX "glossary_entries_region_id_term_idx"
    ON "glossary_entries"("region_id", "term");
