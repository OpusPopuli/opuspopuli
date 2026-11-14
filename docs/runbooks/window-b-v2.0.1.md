# Window B: `v2.0.1` and the UAT corpus

The second of the two production cutover windows (cutover plan §1a). It ships
backend `v2.0.1` and replaces production's civic corpus with UAT's, while
keeping production's user data. The site has been closed since Window A, so
**W1 is already done and W10 is the only reopening.**

| | |
|---|---|
| Ships | `v2.0.1`: #1429 fix (#1438), corpus transfer (#1440, #1443), seed and Vault fix (#1442) |
| Unchanged | prompt-service `v0.5.0`, `frontend-v1.14.1`, the model (`nemotron-3.5-lightning:30b-a3b`) |
| Corpus | `corpus-20261113153233.dump`, sha256 `f1dff79ae7106f0400996cfec4df7077f7b50ca53c7b4e9af7ef29ffb224e3ad`, from `d59cf2f4`. 51 tables, 75 migrations. **Finance empty** (owner, O4). 21 bill summaries kept, 4,435 cleared |
| Rehearsed | G4, 2026-11-13, against `restore_drill` (plan `1439-corpus-transfer.md` §4.6). Its numbers are this window's expected output |
| Time | About 1 hour of commands. The Studio needs someone at it throughout |

Two machines: **[Studio]** is a shell on the Studio, **[Mac]** is the MacBook
checkout of `main` at or after `ced2a8f4`.

## 0. Before the window

- [ ] `v2.0.1` tagged, and `release.yml` has published the images. Image tags
      have no `v`: check `2.0.1` exists for `db-migrate` and `region`.
- [ ] The export and manifest are on the Mac, in `~/corpus-transfer/`.
- [ ] Nemotron isn't loaded on the Mac (`ollama ps`), and UAT is idle.

```bash
# [Studio]
ssh -t opuspopuli@opuspopuli-us-ca
security unlock-keychain ~/Library/Keychains/login.keychain-db
cd /Volumes/OpusPopuli/Development/opuspopuli-node-us-ca
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
tmux new -s windowb            # survives a dropped SSH session
caffeinate -dims &             # no sleep mid-window
```

## W2: stop writes

```bash
# [Studio]
./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml \
  stop region-worker structural-analysis-worker llm-rerank-worker
```

## W3: the backup this window rolls back to

```bash
# [Studio]
docker exec opuspopuli-backup /scripts/backup-db.sh
docker exec opuspopuli-backup /scripts/backup-prompts-db.sh
ls -lah /Volumes/OpusPopuli/backups/ | tail -4
```

Then record the baseline. The user columns must come back **identical** after W8:

```bash
# [Studio]
docker exec opuspopuli-db psql -U postgres -d postgres -tA -F'|' -c "
  select (select count(*) from users), (select count(*) from document_propositions),
         (select count(*) from user_jurisdictions), (select count(*) from email_correspondence),
         (select count(*) from passkey_credentials), (select count(*) from user_addresses),
         (select count(*) from sensitive_profiles),
         (select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null)"
```

Expected from the rehearsal, if no user has changed anything since: `18|0|44|2|…|75`.

## W5: backend `v2.0.1`

```bash
# [Studio]
./bin/op-deploy        # no TAG=, so :previous becomes 2.0.0, the rollback point
```

`v2.0.1` adds no migration. Its `db-migrate` now runs the strict seed: it
**never overwrites** an existing Vault secret or admin, and writes no
published default. It also revokes the Vault RPCs from `anon`,
`authenticated` and `PUBLIC`.

W5 restarts the workers W2 stopped. That's expected, and W8 stops them again.

## W6: verify the backend

1. Migrations are still **75**, and none has `rolled_back_at` set.
2. Every service is `healthy`: `./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml ps`.
3. **The seed did what #1441 says.** In `docker logs opuspopuli-db-migrate`,
   the seed skips the existing admin, and each secret reads `keep (present;
   never overwritten)` or `skip`. No line may say `written to Vault` or
   `GENERATED`. Either one means Vault was missing a secret: **stop**.
4. **Vault RPCs are service-only:**
   ```bash
   docker exec opuspopuli-db psql -U postgres -d postgres -c "
     select p.proname, coalesce(r.rolname, 'PUBLIC') as grantee from pg_proc p
     cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
     where p.proname like 'vault\_%' and a.privilege_type = 'EXECUTE' order by 1, 2"
   ```
   Only `postgres`, `service_role` and the owner `supabase_admin` may appear,
   for each of the three functions. `PUBLIC`, `anon` or `authenticated` means
   the revoke didn't apply: **stop**. On 2026-11-13, before `v2.0.1`, prod
   still showed all three.
5. `llm_host_gate_total` shows `admitted`, not `probe_unreachable`.

**Stop here if any check fails**, and roll back (cutover plan §7).

## W8: load the UAT corpus

Stop the writers again, and the services that read civic tables, so the swap's locks don't wait on them:

```bash
# [Studio]
./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml \
  stop region-worker structural-analysis-worker llm-rerank-worker region
```

Run the transfer **from the Mac**. Confirm the Docker host is the Studio by
CPU count first: both hosts report the name `docker-desktop`, so the name
proves nothing. The Studio has 12, the Mac 10.

```bash
# [Mac]
cd /Volumes/OpusPopuli/Development/opuspopuli/apps/backend
git switch main && git pull --ff-only && git log --oneline -1   # at or after ced2a8f4
ct() { npx ts-node --compiler-options '{"module":"commonjs"}' "scripts/corpus-transfer/$1.ts" "${@:2}"; }
M=~/corpus-transfer/corpus-20261113153233.dump.manifest.json
H=f1dff79ae7106f0400996cfec4df7077f7b50ca53c7b4e9af7ef29ffb224e3ad
export DOCKER_HOST=ssh://opuspopuli@opuspopuli-us-ca
docker info --format '{{.NCPU}}'          # must print 12. Anything else: stop

ct stage --target-db postgres --manifest "$M"                              # dry run
time ct stage --target-db postgres --manifest "$M" --apply --expect-sha256 "$H"
ct swap  --target-db postgres --manifest "$M"                              # checks, no lock
time ct swap --target-db postgres --manifest "$M" --rehearse               # full transaction, rolled back
time ct swap --target-db postgres --manifest "$M" --apply
unset DOCKER_HOST
```

Expected, from the rehearsal:

| Step | Rehearsal | Expected output |
|---|---|---|
| stage `--apply` | 3 min 54 s | Ready. One note: `propositions` column order differs, harmless |
| swap (checks) | 11.5 s | Pass, with the same column-order note |
| swap `--rehearse` | 13.3 s | Rolled back. 2 of 44 user jurisdictions re-pointed, 6 foreign keys recreated, 19 user tables unchanged, 51 civic tables equal to the manifest |
| swap `--apply` | 14.3 s | Committed, with the same numbers |

If the swap refuses or fails, prod's corpus is unchanged (one transaction).
Restart the services and stop. That isn't a rollback, just a re-rehearsal.

Then:

```bash
# [Studio]
docker exec opuspopuli-redis-cache redis-cli FLUSHALL   # the app cache, not BullMQ's redis
```

### Verify (cutover plan §5a.4) before restarting anything

```bash
# [Studio]  the W3 query again: the user columns must match W3 exactly
docker exec opuspopuli-db psql -U postgres -d postgres -tA -F'|' -c "
  select (select count(*) from bills), (select count(*) from propositions),
         (select count(*) from representatives), (select count(*) from jurisdictions),
         (select count(*) from contributions),
         (select count(*) from bills where ai_summary is not null),
         (select count(*) from pg_constraint where contype = 'f' and not convalidated),
         (select count(*) from pg_namespace where nspname = 'corpus_staging'),
         (select count(*) from pg_tables where schemaname = 'public' and tableowner <> 'postgres')"
```

Expected: `5065|72|125|6326|0|21|0|0|0`. **A single user row lost is a
rollback** (cutover plan §7: restore the W3 dump with `--quick`, then the
`:previous` images).

Then restart:

```bash
# [Studio]
./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml up -d
docker logs opuspopuli-region-worker --tail 50   # no sync job queued you didn't intend
```

`up -d` re-runs `db-migrate`. That's harmless now: the seed is strict.

## Before reopening (cutover plan §6)

From the allowlisted IP, with the W1 rule still on:

- [ ] Home page, region page, and one detail page per data type render data.
- [ ] **Campaign finance shows an empty state, not an error.** Finance ships
      empty by owner decision. This waives reopen criterion 2 for finance pages
      only.
- [ ] Search: typeahead and full results.
- [ ] Sign-in with a passkey and with a magic link.
- [ ] **A model-backed answer.** Request a missing bill summary and open one
      AI explanation. This is nemotron's first production use (open since
      Window A).
- [ ] Every AI explanation that showed in UAT shows here. A blank one means
      prompt-service is unreachable (2026-08-17).

## W10: open

Delete the W1 redirect rule. Then run the live checks in cutover plan W10,
and `wrangler tail` for Error 1102.

## After

- Rotate `SENSITIVE_PROFILE_ENCRYPTION_KEY` (prod holds the published dev key,
  1 encrypted row). Safe only now that `v2.0.1`'s seed can't revert it.
- Check prod's `SUPABASE_ANON_KEY` isn't the published demo JWT (#1441).
- Close #1439 with the W8 report.
- Append the PQ evidence to `docs/compliance/releases/v2.0.1-validation.md` §5.
- Remove the maintenance page from the landing site (cutover plan W11).
