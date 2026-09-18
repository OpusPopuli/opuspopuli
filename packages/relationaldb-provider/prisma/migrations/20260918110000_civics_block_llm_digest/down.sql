-- Reverse of 20260918110000_civics_block_llm_digest.
-- Additive column; dropping it loses weight-level attribution for civics
-- blocks but not the blocks, their prompt attribution, or their model name.

ALTER TABLE "civics_blocks" DROP COLUMN IF EXISTS "llm_digest";
