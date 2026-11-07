-- bills-phase-b.md, review of the review fixes: representatives are keyed by
-- seat and renamed in place when a seat changes hands, so no added or removed
-- row signals it. Each derive fingerprints the legislator-to-representative
-- links it used; a bill derived under other links is derived again. NULL
-- counts as different, so the first sync after this derives every bill once.
ALTER TABLE "pubinfo_bills" ADD COLUMN "derived_links_hash" VARCHAR(64);

COMMENT ON COLUMN "pubinfo_bills"."derived_links_hash" IS
  'Hash of the legislator-to-representative links the bill was last derived under';
