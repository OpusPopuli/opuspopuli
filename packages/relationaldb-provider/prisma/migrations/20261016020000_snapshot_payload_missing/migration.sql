-- Record that a snapshot's payload is GONE, as distinct from pruned or never
-- stored (#1363 follow-up).
--
-- `bulk_snapshots` could express three states and needed a fourth:
--
--   storage_key NOT NULL, pruned_at NULL            -> payload is retained
--   storage_key NULL,     pruned_at NULL            -> never uploaded
--   storage_key NULL,     pruned_at NOT NULL        -> pruned by retention
--   storage_key NOT NULL, payload_missing_at NOT NULL -> THIS: expected, gone
--
-- The gap is reachable and not theoretical. `docker-compose-backup.yml` takes
-- a `pg_dump` and does NOT include the Supabase storage volume, so restoring
-- a node brings back every `bulk_snapshots` row while their objects stay lost.
-- Those rows then assert they hold bytes that are not there — a provenance
-- claim the archive cannot honour, which is the same class of defect as a
-- figure that silently omits money, pointed the other way.
--
-- `storage_key` is deliberately PRESERVED rather than nulled when a payload
-- goes missing. Nulling it would make the row indistinguishable from "never
-- uploaded", losing both the fact that we did store it and the key needed to
-- recognise the object if the volume is later restored.
--
-- Nullable and additive: every existing row means "not known to be missing",
-- which is the correct reading for data written before this column existed.
-- The retention sweep sets and CLEARS it, so a restored volume heals the
-- state rather than leaving a permanent scar.

ALTER TABLE "bulk_snapshots"
  ADD COLUMN "payload_missing_at" TIMESTAMPTZ;

COMMENT ON COLUMN "bulk_snapshots"."payload_missing_at" IS
  'Set when a payload this row claims could not be found in storage — data '
  'loss or an outage, not retention. Cleared if the object reappears. '
  'Distinct from pruned_at, which means the retention schedule removed it '
  'deliberately.';
