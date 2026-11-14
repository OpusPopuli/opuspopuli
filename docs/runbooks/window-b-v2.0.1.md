# Window B: `v2.0.1` and the UAT corpus

The second of the two production cutover windows (cutover plan §1a). It ships
backend `v2.0.1` and replaces production's civic corpus with UAT's, while
keeping production's user data. The site has been closed since Window A, so
**W1 is already done and W10 is the only reopening.**

| | |
|---|---|
| Ships | `v2.0.1` (tag on `ced2a8f4`): #1429 fix (#1438), corpus transfer (#1440, #1443), seed and Vault fix (#1442) |
| Unchanged | prompt-service `0.5.0`, `frontend-v1.14.1`, the model (`nemotron-3.5-lightning:30b-a3b`) |
| Corpus | `corpus-20261113153233.dump`, sha256 `f1dff79ae7106f0400996cfec4df7077f7b50ca53c7b4e9af7ef29ffb224e3ad`, from `d59cf2f4`. 51 tables, 75 migrations. **Finance empty** (owner, O4). 21 bill summaries kept, 4,435 cleared |
| Rehearsed | G4, 2026-11-13, against `restore_drill` (plan `1439-corpus-transfer.md` §4.6). Its numbers are this window's expected output |
| Time | About 1 hour of commands. Someone must be able to unlock the Studio's keychain |

Two machines: **[Studio]** is a shell on the Studio. **[Mac]** is the MacBook,
with a clean checkout of `main` at or after `ced2a8f4` and `pnpm install` done.

## 0. Before the window

- [ ] `release.yml` for `v2.0.1` succeeded. Images have no `v`: `2.0.1` exists
      for `db-migrate` and `region`.
- [ ] The export and manifest are in the Mac's `~/corpus-transfer/`.
- [ ] Nemotron isn't loaded on the Mac (`ollama ps`), and UAT is idle.
- [ ] **The Vault RPCs are already service-only.** They were revoked by hand
      on 2026-11-13, and W5 re-applies the revoke. Check with the W6.4 query.
- [ ] The window doesn't span 02:00 (the region-worker cron), or W2's workers
      stay stopped until W8.

```bash
# [Studio]
ssh -t opuspopuli@opuspopuli-us-ca
security unlock-keychain ~/Library/Keychains/login.keychain-db   # op-compose reads every secret from it
cd /Volumes/OpusPopuli/Development/opuspopuli-node-us-ca
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
OC="./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml"
```

## W2: stop writes

```bash
# [Studio]
$OC stop region-worker structural-analysis-worker llm-rerank-worker
```

## W3: the backup this window rolls back to

```bash
# [Studio]
docker exec opuspopuli-backup /scripts/backup-db.sh
docker exec opuspopuli-backup /scripts/backup-prompts-db.sh
ls -lah /Volumes/OpusPopuli/backups/ | tail -4
```

Record the baseline. Save this query as `users.sql`: it runs again after W8,
and the result must be **identical**. It leaves out sessions, logins, events
and audit logs, which change with any activity.

```sql
select (select count(*) from users), (select count(*) from user_profiles),
       (select count(*) from signal_profiles), (select count(*) from sensitive_profiles),
       (select count(*) from passkey_credentials), (select count(*) from user_consents),
       (select count(*) from user_addresses), (select count(*) from user_jurisdictions),
       (select count(*) from email_correspondence), (select count(*) from notification_preferences),
       (select count(*) from documents), (select count(*) from document_propositions),
       (select count(*) from abuse_reports),
       (select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null);
```

```bash
# [Studio]
docker exec -i opuspopuli-db psql -U postgres -d postgres -tA -F'|' < users.sql | tee w3-users.txt
```

The rehearsal's copy had 18 users, 0 petition links, 44 user jurisdictions,
2 correspondence rows, and 75 migrations.

## W5: backend `v2.0.1`

```bash
# [Studio]
./bin/op-deploy        # no TAG=, so :previous becomes 2.0.0, the rollback point
for s in db-migrate region; do
  docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/opuspopuli/$s:latest
  docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/opuspopuli/$s:2.0.1 2>/dev/null || docker pull -q ghcr.io/opuspopuli/$s:2.0.1
done   # each :latest digest must equal its :2.0.1 digest
docker inspect --format '{{.Config.Image}}' opuspopuli-prompts   # prompt-service, still 0.5.0 by digest
```

`v2.0.1` adds no migration. Its `db-migrate` runs the strict seed: it never
overwrites an existing Vault secret or admin, and writes no published
default. It also re-applies the Vault revoke. W5 restarts W2's workers, which is expected.

## W6: verify the backend

1. Migrations are still **75**, and none has `rolled_back_at` set.
2. Every service is `healthy`: `$OC ps`.
3. **The seed did what #1441 says.**
   ```bash
   docker logs opuspopuli-db-migrate 2>&1 | grep -E 'Admin|SENSITIVE_PROFILE|SUPABASE_ANON|REDIS_URL|Vault|BOOTSTRAP|seed'
   ```
   - The admin line says it already exists.
   - There are exactly three secret lines, `SENSITIVE_PROFILE_ENCRYPTION_KEY`,
     `SUPABASE_ANON_KEY` and `REDIS_URL`, each `keep (present; never overwritten)`.
   - **Stop** on any of: `written to Vault`, `GENERATED`, `write failed`,
     `write threw`, `seed skipped`, `Vault seed failed`,
     `BOOTSTRAP SEED UNAVAILABLE`.
4. **The Vault RPCs are service-only:**
   ```bash
   docker exec -i opuspopuli-db psql -U postgres -d postgres <<'SQL'
   select p.proname, coalesce(r.rolname, 'PUBLIC') as grantee from pg_proc p
   cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace and p.proname like 'vault\_%'
     and a.privilege_type = 'EXECUTE' order by 1, 2;
   SQL
   ```
   Expect 9 rows: all three functions, each granted to exactly `postgres`,
   `service_role` and `supabase_admin` (the owner). **Stop** on fewer rows,
   or on any `PUBLIC`, `anon` or `authenticated`.
5. The raw-SQL indexes are present: the 7-index query in
   `release-v1.21.0.md` step 2 (#1168).
6. `llm_host_gate_total` shows `admitted`, not `probe_unreachable`.
7. A GraphQL smoke test from the Mac: `regionSearch` (the CSRF steps are in
   `release-v1.21.0.md` step 2).

**Stop here if any check fails**, and roll back (cutover plan §7).

## W8: load the UAT corpus

**Stop everything that reads or writes `public`**, except the database,
PostgREST, Kong, Redis and the backup scheduler. The swap takes an exclusive
lock on every civic, cache and user table, with a 5-second timeout. G4 ran
against a database nobody else was connected to. The site is closed, so
stopping the app services costs nothing.

```bash
# [Studio]
$OC stop region-worker structural-analysis-worker llm-rerank-worker \
         region knowledge documents users api
docker exec opuspopuli-db psql -U postgres -d postgres -tAc \
  "select usename, application_name, count(*) from pg_stat_activity
   where datname = 'postgres' and pid <> pg_backend_pid() group by 1, 2"
# only Supabase's own roles (authenticator, supabase_admin, …) should remain
```

Run the transfer **from the Mac**. First prove the Docker host is the Studio.
The Mac also has an `opuspopuli-db` with a `postgres` database, and its dev data isn't disposable.

```bash
# [Mac]
cd /Volumes/OpusPopuli/Development/opuspopuli/apps/backend
ct() { npx ts-node --compiler-options '{"module":"commonjs"}' "scripts/corpus-transfer/$1.ts" "${@:2}"; }
M=~/corpus-transfer/corpus-20261113153233.dump.manifest.json
H=f1dff79ae7106f0400996cfec4df7077f7b50ca53c7b4e9af7ef29ffb224e3ad
export DOCKER_HOST=ssh://opuspopuli@opuspopuli-us-ca
docker ps --format '{{.Names}}' | grep -qx opuspopuli-backup && echo STUDIO || { echo 'NOT THE STUDIO'; unset DOCKER_HOST; }

ct stage --target-db postgres --manifest "$M" --expect-sha256 "$H"          # dry run (reads the whole dump over SSH)
time ct stage --target-db postgres --manifest "$M" --apply --expect-sha256 "$H"
ct swap  --target-db postgres --manifest "$M"                               # checks, no lock
time ct swap --target-db postgres --manifest "$M" --rehearse                # full transaction, rolled back
time ct swap --target-db postgres --manifest "$M" --apply
unset DOCKER_HOST
```

Expected, from the rehearsal:

| Step | Rehearsal | Expected output |
|---|---|---|
| stage `--apply` | 3 min 54 s | Ready. One note: `propositions` column order differs, harmless |
| swap (checks) | 11.5 s | Pass, with the same column-order note |
| swap `--rehearse` | 13.3 s | Rolled back. 2 of 44 user jurisdictions re-pointed, 6 foreign keys recreated, user tables unchanged, 51 civic tables equal to the manifest |
| swap `--apply` | 14.3 s | `COMMITTED`, with the same numbers |

**If `--apply` errors, read its last line:**

| Last line | What it means | Do |
|---|---|---|
| "did not commit; production is as it was" | Nothing changed | A lock timeout: check the sessions query and retry. Anything else: restart the services and stop |
| "COMMITTED before the error" | The corpus is live | `docker exec opuspopuli-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"`, then go on to Verify. **Never re-run the swap** |
| "could not tell" | Unknown | Run `select 1 from pg_namespace where nspname = 'corpus_staging'`. A row means it didn't commit; no row means it did |

Then clear the app cache:

```bash
# [Studio]
docker exec opuspopuli-redis-cache redis-cli FLUSHALL   # the app cache, not BullMQ's redis
```

### Verify (cutover plan §5a.4) before restarting anything

```bash
# [Studio]
docker exec -i opuspopuli-db psql -U postgres -d postgres -tA -F'|' < users.sql > w8-users.txt
diff w3-users.txt w8-users.txt && echo 'USERS IDENTICAL'   # any difference: rollback

docker exec opuspopuli-db psql -U postgres -d postgres -tA -F'|' -c "
  select (select count(*) from bills), (select count(*) from propositions),
         (select count(*) from representatives), (select count(*) from jurisdictions),
         (select count(*) from contributions),
         (select count(*) from bills where ai_summary is not null),
         (select count(*) from pg_constraint where contype = 'f' and not convalidated),
         (select count(*) from pg_namespace where nspname = 'corpus_staging'),
         (select count(*) from pg_tables where schemaname = 'public' and tableowner <> 'postgres')"
```

- Expect `USERS IDENTICAL`, then `5065|72|125|6326|0|21|0|0|0`.
- **A single user row lost is a rollback:** restore the W3 dump with
  `--quick`, then the `:previous` images (cutover plan §7).
- Prompt hashes: all but the 137 rows in EX-14 must resolve in prod's
  prompt-service.

### Clear queued syncs, then restart

Jobs queued between W5 and W8 hold the old corpus's IDs:

```bash
# [Studio]
docker exec opuspopuli-db psql -U postgres -d postgres -tAc \
  "select status, count(*) from pipeline_jobs group by 1"   # this table is UAT's now
$OC up -d
$OC ps
docker logs opuspopuli-region-worker --tail 50   # no startup sync job you didn't intend
```

If the worker picks up a job you didn't queue, cancel it with
`cancelRegionSync`. `up -d` re-runs `db-migrate`: repeat W6.3 and W6.4.

## Before reopening (cutover plan §6)

From the allowlisted IP, with the W1 rule still on:

- [ ] The home page, the region page and one detail page per data type render data.
- [ ] **Campaign finance shows an empty state, not an error.** Finance ships
      empty (EX-15). This waives reopen criterion 2 for finance pages only.
- [ ] Search works: typeahead and full results.
- [ ] Sign-in works with a passkey and with a magic link. That user sees
      their address, jurisdictions and petition scans.
- [ ] **A model-backed answer:** request a missing bill summary, and open
      one AI explanation. This is nemotron's first production use.
- [ ] Every AI explanation that showed in UAT shows here. A blank one means
      prompt-service is unreachable (2026-08-17).

## W10: open

Delete the W1 redirect rule. Then run cutover plan W10's live checks, and
`wrangler tail` for Error 1102.

## After

- Rotate the T3 encryption key, now that the seed can't revert it.
- Check prod's anon key against the published defaults.
- Close #1439 with the W8 report.
- Append the production evidence (PQ) to `v2.0.1-validation.md` §5.
- Run cutover plan W11.
