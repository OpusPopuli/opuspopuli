-- Rollback for 20261107180000_pubinfo_committee_hearings. The next pubinfo
-- import rebuilds the mirror once the table is back.
DROP TABLE IF EXISTS "pubinfo_committee_hearings";
