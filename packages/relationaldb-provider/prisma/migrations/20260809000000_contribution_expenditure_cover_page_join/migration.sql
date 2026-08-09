-- #980: attribute contributions and expenditures to the FILING committee.
-- RCPT_CD / EXPN_CD line items carry no FILER_ID, and their CMTE_ID identifies the
-- *counterparty* (contributor / payee), not the filer — so today totalRaised sums
-- money each committee paid out. The recipient/spender is only reachable by joining
-- FILING_ID -> the campaign-disclosure cover page (CVR_CAMPAIGN_DISCLOSURE_CD,
-- already persisted as cvr_filings for #955). This migration adds that join key and
-- lets the linker stamp committee_id post-sync, mirroring independent_expenditures.
--
-- Additive + widening only: new nullable columns and relaxing an existing NOT NULL —
-- no drops, no renames. Both ALTERs are catalog-only in PostgreSQL (ADD COLUMN with
-- no default; DROP NOT NULL, which unlike SET NOT NULL needs no verification scan),
-- so neither rewrites the ~204k-row contributions table.
--
-- Lock duration is set by the CREATE INDEXes below, not the ALTERs: Prisma runs each
-- migration in one transaction, so the ACCESS EXCLUSIVE taken by the first ALTER on a
-- table is held until COMMIT — i.e. across that table's index build. At ~204k rows
-- that is a couple of seconds of blocked writes. CREATE INDEX CONCURRENTLY is not an
-- option for the same reason (it cannot run inside a transaction block), and no
-- migration in this repo uses it.
--
-- Data classification: PII, no PHI — and no new PII. filing_id is a public CAL-ACCESS
-- filing identifier. The donor PII already on contributions (donor_name, employer,
-- occupation, city, state, zip) is untouched here; the volume increase that fix
-- causes is gated on subtask 6, not this migration. No RLS policies exist on these
-- tables (none exist anywhere in this schema); access is mediated by the region
-- service, so this changes no exposure surface.
--
-- Coordinated deploy: migration lands first and is inert on its own. Once the region
-- config drops the CMTE_ID -> committeeId mapping (#980 subtask 5), rows arrive with
-- a NULL committee until the cover-page linker (subtask 4) stamps them.

-- Contributions: RCPT_CD FILING_ID -> cover page -> recipient committee.
ALTER TABLE "contributions" ALTER COLUMN "committee_id" DROP NOT NULL;
ALTER TABLE "contributions" ADD COLUMN "filing_id" VARCHAR(50);

CREATE INDEX "contributions_filing_id_idx" ON "contributions"("filing_id");

-- Expenditures: EXPN_CD FILING_ID -> cover page -> spending committee.
ALTER TABLE "expenditures" ALTER COLUMN "committee_id" DROP NOT NULL;
ALTER TABLE "expenditures" ADD COLUMN "filing_id" VARCHAR(50);

CREATE INDEX "expenditures_filing_id_idx" ON "expenditures"("filing_id");
