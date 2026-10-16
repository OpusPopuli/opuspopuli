-- Provision the bulk-archive storage bucket and the privileges the app needs
-- to use it (#1363).
--
-- WHY THIS FILE EXISTS
--
-- The bulk-archive tier (#1277) retained nothing, in any environment, from the
-- day it was built until this file was added. `storage.buckets` was EMPTY and
-- `storage.objects` / `storage.buckets` carried **zero grants for any role**,
-- so every upload was rejected and each snapshot row landed with
-- `storage_key` NULL — recorded as a snapshot that simply has no payload. The
-- 1,521 MB CAL-ACCESS export was discarded on every sync.
--
-- #1371 gave the app an `ensureBucket` capability, which was necessary and
-- NOT sufficient: `createBucket` is itself refused, because `service_role` has
-- no INSERT privilege on `storage.buckets`. BYPASSRLS is not a grant.
--
-- A hosted Supabase project provisions these grants as part of the platform.
-- The self-hosted compose stack does not, which is why this gap was invisible
-- in design and total in practice.
--
-- HOW IT IS APPLIED
--
-- Through pg-meta `/query` from `db-migrate.sh`, the same mechanism that
-- installs `99_vault_functions.sql`. pg-meta runs as `supabase_admin`
-- (superuser), which is the only role able to write `storage.buckets` —
-- `postgres` cannot, and cannot `SET ROLE supabase_storage_admin` either.
--
-- Declarative and idempotent ON PURPOSE. A provisioning step that lives in a
-- runbook is a step a new operator does not run, and that is precisely how
-- #1277's retention guarantee came to be false everywhere. `docker compose up`
-- must produce a stack that retains archives with no manual action.

-- ---------------------------------------------------------------------------
-- 1. The bucket.
-- ---------------------------------------------------------------------------
-- PRIVATE. These archives are raw public-record exports that include
-- contributor names and addresses. Lawfully public is not the same as
-- world-readable from our object store.
--
-- `file_size_limit` is 3 GiB against a ~1.52 GB export. Supabase enforces a
-- per-file limit that defaults to 50 MB, which would reject the export outright
-- and is the second thing that had to be right for retention to work at all.
insert into storage.buckets (id, name, public, file_size_limit)
values ('bulk-archives', 'bulk-archives', false, 3221225472)
on conflict (id) do update
  set public = false,
      file_size_limit = greatest(
        coalesce(storage.buckets.file_size_limit, 0),
        3221225472
      );

-- ---------------------------------------------------------------------------
-- 2. The grants hosted Supabase provides and self-hosted does not.
-- ---------------------------------------------------------------------------
-- `service_role` only. Deliberately NOT `anon` or `authenticated`: the archive
-- is private, and the app reaches it with the service-role key.
grant usage on schema storage to service_role;
grant select, insert, update, delete on storage.buckets to service_role;
grant select, insert, update, delete on storage.objects to service_role;

-- No RLS policies are added. `service_role` holds BYPASSRLS, so a policy would
-- be dead weight that implies a restriction it does not impose. If a future
-- surface needs `authenticated` access to an archive, that wants its own
-- policy and its own decision about who may read contributor data in bulk.
