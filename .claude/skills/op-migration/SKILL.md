---
name: op-migration
description: Create an additive-safe Supabase migration (up + rollback), checking indexes, RLS, FKs, and data classification. Use when a change needs a schema migration in the opuspopuli monorepo.
argument-hint: <what the migration should do>
---

Create a Supabase migration for: $ARGUMENTS

1. Draft the up migration SQL
2. Draft the down/rollback migration SQL
3. Check for: index requirements (especially pgvector indexes), RLS policy impacts, foreign key safety
4. Verify the migration is additive — no destructive column drops or renames without a deprecation path
   (additive-only on existing tables in production; deprecate first, remove in a follow-up after deploy)
5. Check that any new columns have appropriate defaults for existing rows
6. **Data classification (HIPAA):** if a new column or table holds PHI/PII, say so, confirm an RLS policy
   restricts access, and confirm it will be masked in audit logs. Regulated columns must not be world-readable.
7. Name the migration file with timestamp + descriptive slug, under `supabase/migrations/`
8. Show me the full SQL for review before writing any files

Flag if this migration requires a coordinated deploy with application code changes.

> Repo-specific skill: this encodes the opuspopuli monorepo's Supabase migration layout and additive-only
> rules, so it lives here rather than in the shared `opuspopuli-sdlc` plugin.
