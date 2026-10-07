-- Per-term glossary provenance, so a block delete can prune correctly.
--
-- Additive only: one new table, two foreign keys on it, three indexes, and a
-- backfill that inserts. No existing column is dropped, renamed or altered,
-- and no existing row is deleted (see "Orphans" below for why that is left to
-- the application rather than done here).
--
-- ---------------------------------------------------------------------------
-- Why a join table instead of the obvious foreign key
--
-- `glossary_entries` is keyed (region_id, slug) and its `source_url` records
-- only the most RECENT page that wrote the term — the model is explicitly
-- last-write-wins. So the tempting one-liner,
--
--     ALTER TABLE glossary_entries ADD FOREIGN KEY (region_id, source_url)
--       REFERENCES civics_blocks (region_id, source_url) ON DELETE CASCADE;
--
-- is wrong. Measured on the California corpus as of 2026-10-02: 23 of 137
-- terms were defined on more than one page — `daily-file` on four pages,
-- `engrossed`, `enrolled`, `chaptered` and `conference-committee` on three
-- each. That cascade would delete a term when ANY one of its defining pages
-- was removed, including when other pages still define it. Integrity in name,
-- silent data loss in practice.
--
-- One row per (term, page) makes the real relationship explicit, which is what
-- lets the cascade be correct.
-- ---------------------------------------------------------------------------

CREATE TABLE "glossary_entry_sources" (
    "id"           TEXT NOT NULL,
    "region_id"    TEXT NOT NULL,
    "slug"         TEXT NOT NULL,
    "source_url"   TEXT NOT NULL,
    "extracted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "glossary_entry_sources_pkey" PRIMARY KEY ("id")
);

-- One row per term per page.
CREATE UNIQUE INDEX "glossary_entry_sources_region_id_slug_source_url_key"
    ON "glossary_entry_sources" ("region_id", "slug", "source_url");

-- "Which pages define this term" — the read that decides whether a term
-- survives a block delete.
CREATE INDEX "glossary_entry_sources_region_id_slug_idx"
    ON "glossary_entry_sources" ("region_id", "slug");

-- Postgres does not index foreign-key columns automatically, and the cascade
-- below deletes BY this pair on every block delete.
CREATE INDEX "glossary_entry_sources_region_id_source_url_idx"
    ON "glossary_entry_sources" ("region_id", "source_url");

-- Deleting the canonical term removes its provenance.
ALTER TABLE "glossary_entry_sources"
    ADD CONSTRAINT "glossary_entry_sources_region_id_slug_fkey"
    FOREIGN KEY ("region_id", "slug") REFERENCES "glossary_entries"("region_id", "slug")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a page's block removes that page's contributions — and ONLY that
-- page's. This is the constraint the naive version could not express.
ALTER TABLE "glossary_entry_sources"
    ADD CONSTRAINT "glossary_entry_sources_region_id_source_url_fkey"
    FOREIGN KEY ("region_id", "source_url") REFERENCES "civics_blocks"("region_id", "source_url")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill
--
-- One source row per existing glossary entry, from the only provenance that
-- survives: its current `source_url`. Historical multi-page provenance is NOT
-- recoverable — last-write-wins overwrote it, which is the defect this table
-- fixes going forward, not one it can repair backwards. Expect terms that are
-- defined on several pages to start with a single source row and gain the rest
-- on the next sync of those pages.
--
-- Orphans: entries whose `source_url` has no `civics_blocks` row are skipped
-- by the join, so they keep their canonical row and get no provenance. The FK
-- cannot reject them because nothing is inserted for them. They are left in
-- place deliberately — deleting rows is not additive, and the application
-- prune (a term whose last source is gone) is the right place to retire them.
-- ---------------------------------------------------------------------------

INSERT INTO "glossary_entry_sources" ("id", "region_id", "slug", "source_url", "extracted_at")
SELECT gen_random_uuid()::TEXT, g."region_id", g."slug", g."source_url", g."extracted_at"
FROM "glossary_entries" g
JOIN "civics_blocks" c
  ON c."region_id" = g."region_id"
 AND c."source_url" = g."source_url"
ON CONFLICT ("region_id", "slug", "source_url") DO NOTHING;
