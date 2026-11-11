# #1441: db-migrate seeds dev defaults into production

| | |
|---|---|
| Issue | [#1441](https://github.com/OpusPopuli/opuspopuli/issues/1441) |
| Date | 2026-11-10 |
| Author | Rodney Gagnon, with Claude Code |
| Target | `v2.0.1` (Window B step 3, `production-cutover-maintenance-window.md` §1a) |
| Data classification | Secrets and auth configuration, no CCPA personal information. The seed handles the T3 encryption key that protects `sensitive_profiles` (personal information), and the admin credential |

## Problem

`db-migrate.sh` runs on every `up -d`. On every stack it created `admin@opuspopuli.local` with `Admin1234!` when absent, and upserted `SENSITIVE_PROFILE_ENCRYPTION_KEY` and `SUPABASE_ANON_KEY` to values published in this repo. Production had both (found 2026-11-08). The key couldn't be rotated, because the next deploy would revert it.

Found while testing the fix: every Vault RPC (`vault_read_secret`, `vault_list_secrets`, `vault_create_secret`) was executable by `PUBLIC`, `anon` and `authenticated`, and confirmed so on production on 2026-11-10. Anyone reaching Kong with the anon key or a user JWT could read and rewrite every Vault secret. Kong is on the Studio's `*:8000` and isn't on the Cloudflare tunnel.

## Change

1. The admin and Vault seeds move from inline `node -e` into `apps/backend/scripts/bootstrap-seed/seed.ts`, run with ts-node, with unit tests.
2. **Dev defaults are opt-in.** Only `SEED_DEV_DEFAULTS=true` (set in the UAT, integration and e2e compose files) gives the old behaviour. Every other stack gets the strict policy: no published default, no overwrite of an existing secret, and the first admin only from `SEED_ADMIN_PASSWORD`. When absent, the encryption key is generated. `NODE_ENV` isn't used, because `--local-only` nodes run as `development`.
3. The strict policy lists Vault names first and writes nothing if it can't.
4. `99_vault_functions.sql` revokes `EXECUTE` from `PUBLIC, anon, authenticated`. Only `service_role` and `postgres` keep it. It's re-applied by every deploy.
5. Shell hardening: the admin id passes to psql as a variable and only if it's a single UUID, and a missing ts-node is reported loudly.

No Prisma migration, and no GraphQL or federation change.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| A node without the opt-in loses the dev admin and secrets it relied on | medium × possible | Opt-in set in all three dev compose files. Existing secrets and admins are never removed, only no longer created with defaults |
| The revoke breaks a legitimate Vault reader | high × rare | Every app path uses the service-role key, and callers fall back to env on error. The `SUPABASE_ANON_KEY` fallback in `supabase-vault.provider.ts` no longer reaches Vault, by design |
| Prod Vault already holds published values (encryption key, possibly the demo anon JWT) | high × likely | Never overwritten by design. Rotate after `v2.0.1` per the cutover plan, and check the anon key by hand |
| The current image's next deploy re-grants `authenticated` on `vault_read_secret` before `v2.0.1` | high × possible | Owner re-runs the revoke after any pre-`v2.0.1` deploy |
| ts-node over the 256 MB limit | medium × rare | Verified: the full script ran in the image at 256 MB, in both modes |
| GPL dependency | — | None added |

## Verification

- 20 unit tests. Each strict guard was mutation-checked (removing it fails a test).
- The full `db-migrate.sh` ran in the real image at 256 MB against local UAT, with and without the opt-in, exiting 0 both times. Local UAT's `service_role` lacks `USAGE` on `public`, so writes there return 403. That's a pre-existing gap, not this change.
- `99_vault_functions.sql` applied in a rolled-back transaction leaves only `postgres` and `service_role`.
