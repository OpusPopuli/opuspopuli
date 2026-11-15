# Incident: Supabase API roles held full access to the `public` schema

| | |
|---|---|
| Found | 2026-11-13 (Vault RPCs) and 2026-11-14 (tables), during the `v2.0.1` cutover (Window B) |
| Contained | 2026-11-13 (Vault RPCs) and 2026-11-15 (tables), by hand on production |
| Severity | High: personal information was exposed, with no evidence it was accessed |
| Data classes | `ca-personal-information` (`users`, `user_addresses`, `email_correspondence`, `passkey_credentials`, and `sensitive_profiles`, which is encrypted); the node's Vault secrets |
| Status | Contained. Permanent enforcement tracked in a follow-up issue |

## What was exposed

Supabase grants its API roles, `anon` and `authenticated`, every privilege on
each table, sequence and function created in `public`. It does this through
default privileges set when the cluster is created. Every table the app
creates through Prisma got them, and row-level security was off throughout,
because the app never uses it: it reaches the database as `postgres`.

PostgREST serves `public` through Kong. So anyone who could reach the node's
Supabase API with the anon key could:

- read, change or delete any row of any `public` table, user tables included;
- call `vault_read_secret`, `vault_list_secrets` and `vault_create_secret`, and so
  read or replace every Vault secret.

The anon key is public by design: the frontend ships it.

## Evidence of access

Kong's logs from its last start (2026-11-01) to containment show:

- 11,884 `/rest/v1` requests, every one from the app's own containers, and
  every one a Vault call (`rpc/vault_*` and `decrypted_secrets`);
- outside the Docker network, only requests to `/auth/v1` (sign-in and
  health), and none to `/rest/v1`.

Vault's last write was the Window A deploy seed (2026-11-09 03:34 UTC). User
counts were unchanged across the window.

**Logs before 2026-11-01 no longer exist.** There is no evidence either way for that period.

## How it was found

- **Vault RPCs.** Found while testing #1441 locally, then confirmed on
  production. Revoked from `PUBLIC`, `anon` and `authenticated` by hand on
  2026-11-13. `v2.0.1`'s `99_vault_functions.sql` now re-applies the revoke on
  every deploy.
- **Tables.** Found when the corpus transfer's catalog comparison (#1439)
  refused to swap. The staged tables carried no grants, while the live ones
  granted `anon` and `authenticated` everything. The G4 rehearsal ran against
  a copy restored with `--no-acl`, so it couldn't have seen this.

## Containment (2026-11-15, owner-approved)

As `supabase_admin`, in one transaction:

```sql
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
```

Afterwards no `public` table was readable by either role, and `service_role`
kept its access. The app was unaffected: it reaches every table through
Prisma as `postgres`, and calls PostgREST only for Vault, as `service_role`.

## Follow-ups

1. Enforce the revoke on every deploy, as `99_vault_functions.sql` does for
   Vault. Otherwise a rebuilt cluster gets Supabase's default privileges back.
2. #1444, the local database without `USAGE` on `public`: its fix must not
   re-grant `anon` or `authenticated` anything.
3. Rotate the T3 encryption key. It's safe now, since `v2.0.1`'s seed can't
   revert it.
4. Check whether a CCPA notice duty applies. There's no evidence of access,
   but the logs cover only 2026-11-01 onward.
