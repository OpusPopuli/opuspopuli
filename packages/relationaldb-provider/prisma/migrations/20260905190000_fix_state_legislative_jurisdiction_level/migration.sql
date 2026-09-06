-- State legislative districts were seeded with level = 'DISTRICT'.
--
-- `jurisdictions.level` is what the profile groups by, and 'DISTRICT' is the
-- bucket rendered as "Special Districts" — so all 80 Assembly districts, and
-- the 13 Senate districts that have not been re-fetched, appear alongside
-- water, fire and school districts rather than as state legislature.
--
-- ── Why only some rows are wrong ──────────────────────────────────────────
--
-- Two paths populate this table and they disagree:
--
--   seeded   20260525230000_seed_ca_jurisdictions  fips_code '06AD001'
--            writes level = 'DISTRICT' for assembly, senate AND congressional
--   fetched  BoundaryLoaderService (TIGERweb)      fips_code 'sldu-06001'
--            writes the correct level, and adopts the seeded row's identity
--
-- Congressional is already correct in production because all 52 rows have been
-- fetched. Senate is split 27 fetched / 13 seeded. Assembly has never been
-- fetched, so all 80 still carry the seed's value. The seed is the only source
-- of the wrong level; fetching fixes it as a side effect.
--
-- ── Why this is a new migration rather than an edit to the seed ───────────
--
-- 20260525230000 has been applied in production. Editing it changes its
-- checksum, and `prisma migrate deploy` then refuses to run at all with
-- "migration modified after being applied". So the seed is left alone and this
-- runs after it — which corrects an existing database and a freshly-created one
-- by the same statement.
--
-- Idempotent, and safe to run when a later fetch has already fixed some rows:
-- the WHERE clause only touches rows still on 'DISTRICT'.
--
-- Scope check before writing this: 93 rows change (80 assembly, 13 senate).
-- Every other row on level 'DISTRICT' is a genuine special district —
-- water 3988, fire 654, school 965 — and is untouched.

UPDATE jurisdictions
   SET level = 'STATE', updated_at = now()
 WHERE type IN ('STATE_ASSEMBLY_DISTRICT', 'STATE_SENATE_DISTRICT')
   AND level = 'DISTRICT';

-- ── Rollback ──────────────────────────────────────────────────────────────
-- Restores the previous (incorrect) value for exactly the rows this changed.
-- Scoped by the seed's fips_code prefixes rather than by type, so it cannot
-- clobber a fetched row that was legitimately 'STATE' beforehand.
--
--   UPDATE jurisdictions
--      SET level = 'DISTRICT'
--    WHERE type IN ('STATE_ASSEMBLY_DISTRICT', 'STATE_SENATE_DISTRICT')
--      AND (fips_code LIKE '06AD%' OR fips_code LIKE '06SD%');
