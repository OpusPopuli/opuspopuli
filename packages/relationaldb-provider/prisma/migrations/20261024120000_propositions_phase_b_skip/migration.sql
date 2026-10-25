-- Propositions Phase B (docs/plans/propositions-phase-b.md §1–2).
-- Additive only: nullable columns, no backfill in SQL. The analysis config
-- hash is stamped at runtime on the first sync, because it includes the
-- EFFECTIVE maxTokens, which a node can override
-- (PROPOSITION_ANALYSIS_MAX_TOKENS) — a literal here would be wrong there.

-- K-P1: the parser's own output beside the bytes it came from, so an
-- unchanged PDF is not re-parsed every run. Not derived_text: that is
-- write-once and holds what the SUBJECT row stored (minutes truncate it).
ALTER TABLE "source_versions"
    ADD COLUMN "parsed_text"      TEXT,
    ADD COLUMN "parsed_text_hash" VARCHAR(64),
    ADD COLUMN "parser_version"   VARCHAR(40);

-- K-P2: the analysis skip key's config axis — the analyzer version and the
-- effective generation settings that shape what is stored.
ALTER TABLE "propositions"
    ADD COLUMN "analysis_config_hash"   VARCHAR(64),
    -- Attribution: which weights produced the vector (Ollama exposes a
    -- digest; xenova leaves it null and keeps its model id in
    -- embedding_model).
    ADD COLUMN "embedding_model_digest" VARCHAR(80);
