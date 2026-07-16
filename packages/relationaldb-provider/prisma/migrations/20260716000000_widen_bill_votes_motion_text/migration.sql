-- #901: bill_votes column widths too short for full roll-call motions.
-- createMany is atomic, so one over-long motion_text drops the bill's whole
-- vote set (extraction-failed, 0 votes). This was masked before #894 —
-- truncated JSON never parsed and never reached the insert. motion_text is
-- free-form (no natural length) → text. Widen representative_name → text and
-- position → varchar(50) defensively. varchar(n)→text and varchar(n)→varchar(m>n)
-- are no-rewrite in Postgres — safe on prod, additive (no drops/renames).
ALTER TABLE "bill_votes" ALTER COLUMN "motion_text" TYPE TEXT;
ALTER TABLE "bill_votes" ALTER COLUMN "representative_name" TYPE TEXT;
ALTER TABLE "bill_votes" ALTER COLUMN "position" TYPE VARCHAR(50);
