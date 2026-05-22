-- Wipe CalAccess campaign finance rows that were ingested with FILING_ID as
-- externalId. FILING_ID is a filing-level key shared by all transactions in a
-- Form 460/496 report, so every upsert within a filing collided on the same
-- row — only the last record processed per filing survived.
--
-- The correct key is TRAN_ID (per-transaction). The opuspopuli-regions config
-- has been updated to map TRAN_ID → externalId. A full CalAccess re-sync is
-- required after this migration runs to rebuild these tables with correct data.
--
-- cvr2_filings is NOT truncated — it already uses TRAN_ID correctly.
-- FEC and county sources are NOT affected — different key schemes.

TRUNCATE public.contributions;
TRUNCATE public.expenditures;
TRUNCATE public.independent_expenditures;
