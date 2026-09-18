-- #1276 — content-addressed, append-only store for cited sources.
--
-- Additive only: creates one new table and touches nothing existing, so it is
-- safe to apply to production ahead of the code that writes to it.
--
-- Identity is content_hash (SHA-256 over the raw response body, taken before
-- decoding), not the URL: an unchanged re-fetch collides with the existing row
-- and stores no new bytes, so the table grows with source *change* rather than
-- with fetch frequency.
--
-- Bytes live in Postgres rather than object storage for this tier
-- deliberately: it keeps the payload transactional with its hash (no window
-- where a hash exists whose bytes do not) and inside the backup that has been
-- verified restorable. See docs/plans/1276-source-version-store.md §5.

CREATE TABLE "source_versions" (
    "id" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "content_type" VARCHAR(255),
    "source_url" VARCHAR(1000) NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "etag" TEXT,
    "last_modified" VARCHAR(255),
    "region_id" VARCHAR(100),
    "data_type" VARCHAR(50),
    "execution_id" TEXT,
    "manifest_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_versions_pkey" PRIMARY KEY ("id")
);

-- The content address. Unique because it *is* the dedup mechanism: a second
-- insert of identical bytes must collide rather than duplicate the payload.
CREATE UNIQUE INDEX "source_versions_content_hash_key"
    ON "source_versions"("content_hash");

-- "what did this URL look like over time" — the history read.
CREATE INDEX "source_versions_source_url_fetched_at_idx"
    ON "source_versions"("source_url", "fetched_at");

CREATE INDEX "source_versions_execution_id_idx"
    ON "source_versions"("execution_id");

CREATE INDEX "source_versions_manifest_id_idx"
    ON "source_versions"("manifest_id");

CREATE INDEX "source_versions_region_id_data_type_idx"
    ON "source_versions"("region_id", "data_type");

-- ON DELETE SET NULL, not CASCADE: a stored artifact must outlive the
-- bookkeeping of the run that fetched it. Pruning pipeline history must never
-- silently delete evidence.
ALTER TABLE "source_versions"
    ADD CONSTRAINT "source_versions_execution_id_fkey"
    FOREIGN KEY ("execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "source_versions"
    ADD CONSTRAINT "source_versions_manifest_id_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "structural_manifests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
