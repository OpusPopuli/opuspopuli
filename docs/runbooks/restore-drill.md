# Runbook — database restore drill

| | |
|---|---|
| **Purpose** | Prove a production snapshot can actually be restored, on a scratch database, without touching production. |
| **Why it exists** | opuspopuli#1217. Backups ran unnoticed-broken for 50 days. "We take backups" and "we can recover" are different claims, and only the second one matters. |
| **Status** | **The core claim is already evidenced** — see §0. What remains is narrow and node-specific. |
| **Cadence** | After any change to `backup/scripts/*`, after a Postgres major upgrade, and quarterly otherwise. |
| **Gates** | R4/M1 (`docs/plans/ai-architecture-roadmap.md`) — an immutable source tier is not a credible guarantee on a database nobody has restored. |
| **Duration** | ~20–40 min (20 GB database). |
| **Risk to production** | Low **if** §2 is followed exactly. Non-zero I/O contention. Read §2 before anything else. |

---

## 0. What is already proven — read before scheduling a drill

A production snapshot **has been restored successfully**, into the local development stack. Verified 2026-09-11 by comparing the local database against the production baseline:

| Table | Production | Local (restored) |
|---|---|---|
| `bills` | 5019 | **5019** |
| `propositions` | 64 | **64** |
| `representatives` | 125 | **125** |
| `contributions` | **18,055,411** | **18,055,411** |
| `public` tables | 60 | **60** |
| `users` | 17 | 31 *(local test accounts added after restore)* |

An exact match on 18 million rows is not coincidence. **The dumps are readable, `pg_restore` reconstructs schema and data faithfully, and the restored database has been in daily development use since** — which is a stronger usability signal than any scripted assertion in §5.

So the question "are these backups restorable?" is **answered: yes**. Do not re-run a full drill to re-answer it.

### What that restore did *not* exercise

> **Updated 2026-09-16 — items 1 and 2 are now CLOSED.** A `--full` drill was run on the local
> stack (§7) where `postgres` is `NOSUPERUSER` and `supabase_admin` holds SUPERUSER — the same
> role split as the node. `DROP`/`CREATE DATABASE` as `supabase_admin` succeeded, both JWT GUCs
> were re-applied and verified set, and the dump's `CREATE EXTENSION` statements ran via
> `BACKUP_SUPERUSER`. **Item 3 remains open** and is the only reason left to run this on the node.

Narrow, node-specific, and the only reasons to run §4 at all:

1. **`restore-db.sh --full`'s supabase-specific steps** — `DROP`/`CREATE DATABASE` as `supabase_admin`, and re-applying the `app.settings.jwt_secret` / `jwt_exp` GUCs. A single-database `pg_dump` does **not** carry `ALTER DATABASE ... SET`, and the script's own comment is emphatic that without them PostgREST auth breaks **silently** after a restore. If the local restore used any other path, this remains untested.
2. **The `NOSUPERUSER` demotion on the node.** On the supabase image the everyday `postgres` role cannot run the dump's `CREATE EXTENSION` (postgis / vector / pg_trgm). The script routes around it via `BACKUP_SUPERUSER`; a local restore run as a superuser would not have exercised that.
3. **Recovery time on node hardware** — still unknown, and it is the number an incident actually needs.

If the local restore was performed *with* `restore-db.sh --full`, item 1 is covered too and only items 2–3 remain.

---

## 1. The hazard, stated first

`backup/scripts/restore-db.sh` line ~64:

```bash
TARGET_DB="${PGDATABASE:-postgres}"
```

The backup container runs with **`PGDATABASE=postgres`** — the production database. Therefore:

> **Running `restore-db.sh` inside `opuspopuli-backup` with default env DESTROYS PRODUCTION.**
> `--full` issues `DROP DATABASE IF EXISTS "postgres"` as `supabase_admin`.

Every step below overrides `PGDATABASE` to a scratch name. **Never** run the restore script in that container without that override.

Two properties make the scratch approach safe, both verified in the script:

- `pg_terminate_backend` is scoped `WHERE datname = '${TARGET_DB}'` — with a scratch target it cannot disconnect production clients.
- `DROP DATABASE` / `CREATE DATABASE` are issued against `template1`, naming `${TARGET_DB}` explicitly.

## 2. Pre-flight

Run these and confirm each before proceeding.

```bash
ssh -t opuspopuli@opuspopuli-us-ca
security unlock-keychain ~/Library/Keychains/login.keychain-db
cd /Volumes/OpusPopuli/Development/opuspopuli-node-us-ca
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
```

| # | Check | Command | Required |
|---|---|---|---|
| 1 | Not near a backup window | `date` | **Not** 02:45–03:30 America/Los_Angeles. `restore-db.sh` takes the same flock as `backup-db.sh`; overlapping blocks one of them. |
| 2 | Backup service healthy | `docker ps --filter name=opuspopuli-backup` | `Up` |
| 3 | Snapshot exists | `ls -lah /Volumes/OpusPopuli/backups/opuspopuli-db-*.dump.gz` | at least one |
| 4 | DB volume headroom | `docker exec opuspopuli-db df -h /var/lib/postgresql/data` | ≥ 2× prod DB size free (prod is 20 GB → need ≥ 40 GB; had 225 GB) |
| 5 | Scratch name is unused | `docker exec opuspopuli-db psql -U postgres -lqt \| cut -d'\|' -f1 \| grep -w restore_drill` | **no output** |

> If check 5 returns anything, stop and pick another name. The drill drops the database it targets.

## 3. Capture the production baseline

The drill is only meaningful if you compare the restored database against something. Capture **before** restoring:

```bash
docker exec opuspopuli-db psql -U postgres -d postgres -t -A -F'|' -c "
  select (select count(*) from bills),
         (select count(*) from propositions),
         (select count(*) from representatives),
         (select count(*) from users),
         (select count(*) from contributions),
         (select count(*) from information_schema.tables where table_schema='public')"
```

Baseline recorded 2026-09-11 (snapshot `opuspopuli-db-unknown-20260911T182042Z.dump.gz`, 1.96 GB compressed / 20 GB restored):

```
bills=5019 | props=64 | reps=125 | users=17 | contributions=18055411 | public_tables=60
extensions: plpgsql, uuid-ossp, pgcrypto, postgis, pg_trgm, vector,
            pg_net, pg_stat_statements, supabase_vault
```

Counts drift as sync runs — re-capture each drill rather than trusting these.

## 4. Run the restore

Use **`--full`**, not `--quick`: `--quick` needs an existing database and `pg_restore --clean`s in place; `--full` creates the scratch database, which is what a drill wants.

**Do not pass `--yes`.** The confirmation prompt prints the resolved target, and reading that line is the last safety gate before a destructive operation:

```
Restore plan:
  Snapshot file   : opuspopuli-db-unknown-20260911T182042Z.dump.gz
  Target DB       : restore_drill@opuspopuli-db      ← READ THIS LINE
  This will DESTROY all data currently in restore_drill.
```

If that line says anything other than your scratch database, **type `no`**.

```bash
SNAP=/backups/opuspopuli-db-unknown-20260911T182042Z.dump.gz   # adjust

docker exec -it \
  -e PGDATABASE=restore_drill \
  opuspopuli-backup \
  /scripts/restore-db.sh --full "$SNAP"
```

`--full` requires `JWT_SECRET`, which the container already carries from `op-compose`'s keychain export; it fails closed if unset rather than restoring a database whose PostgREST auth is silently broken.

## 5. Verify — the part that makes it a drill

Exit code 0 proves the script ran, not that the data is usable.

```bash
docker exec opuspopuli-db psql -U postgres -d restore_drill -t -A -F'|' -c "
  select (select count(*) from bills),
         (select count(*) from propositions),
         (select count(*) from representatives),
         (select count(*) from users),
         (select count(*) from contributions),
         (select count(*) from information_schema.tables where table_schema='public')"
```

| Check | Pass condition |
|---|---|
| Row counts | Match §3 baseline, or exceed it only where sync ran between snapshot and baseline capture |
| Table count | Equal to baseline (60) |
| Extensions | `select extname from pg_extension` includes **postgis, vector, pg_trgm** — these need SUPERUSER to create and are the most likely silent restore failure |
| Vector index | `select indexname from pg_indexes where tablename='propositions' and indexdef ilike '%hnsw%'` returns a row (opuspopuli#1150) |
| Recent migration | `select count(*) from information_schema.columns where table_name='representatives' and column_name='bio_prompt_hash'` = 1 (opuspopuli#1149) |
| JWT GUCs | `select current_setting('app.settings.jwt_secret', true) is not null` = `t` — the `--full` path re-applies these; a single-DB `pg_dump` does not carry them, and their absence breaks PostgREST auth **silently** |
| Spot-read | `select bill_number, title from bills order by updated_at desc limit 3` returns plausible rows |

Record the wall-clock time of §4. **That number is the recovery-time estimate** — the drill's other deliverable.

## 6. Clean up

The scratch database holds a full copy (~20 GB). Drop it:

```bash
docker exec opuspopuli-db psql -U postgres -d template1 -c 'DROP DATABASE IF EXISTS restore_drill'
docker exec opuspopuli-db df -h /var/lib/postgresql/data   # confirm reclaimed
```

## 7. Record the result

Append to the table below and update **E-8** in the current release validation pack (`docs/compliance/releases/*-validation.md`).

| Date | Snapshot | Target | Mode | Duration | Result | Notes |
|---|---|---|---|---|---|---|
| ~2026-09 | prod snapshot | local dev stack | *(method TBC)* | not recorded | **PASS** | Verified by row-count parity incl. 18,055,411 contributions exact. Method not captured — see §0 items 1–3. |
| 2026-09-16 | `opuspopuli-db-unknown-20260916T100000Z.dump.gz` (1.96 GB gz / ~11 GB restored) | `restore_drill` on the **local** stack | `--full` | **226 s (3m46s)** | **PASS** | Closes §0 items 1 and 2. Row counts exact against the prod baseline captured the same day (bills 5019, props 69, reps 125, users 17, contributions 18,055,411, 60 public tables); all 9 extensions present incl. postgis/vector/pg_trgm; HNSW index present (#1150); `bio_prompt_hash` present (#1149); **`app.settings.jwt_secret` GUC set and `jwt_exp`=3600** — the silent-auth-break path, previously untested. Snapshot SHA-256 verified against the node before restoring. |
| _(pending)_ | | `restore_drill` **on the node** | `--full` | | | §0 item 3 only — recovery time on node hardware. |

## 8. Known gaps

- **`git_sha` is `unknown`** on the 2026-09-11 snapshot. `GIT_SHA` is baked at image build and was not set when that image was built, so the script's schema-drift advisory cannot fire and the snapshot cannot say which code version produced it. Fix at the source (build arg), not here.
- **Restores are not rehearsed under failure.** This drill restores a good snapshot to an empty target. It does not exercise a corrupt snapshot, a truncated dump, or a mid-restore failure.
- **Only the main database.** `backup-prompts-db.sh` snapshots `prompt_service` separately and has its own restore path, not covered here.
- **The drill's own timing came from an external stopwatch, not the script.** `restore-db.sh`
  logged `duration_ms: 226` for a run that took 226 *seconds*. BusyBox `date` ignores `%N`, so
  every `duration_ms` this project has ever recorded is seconds mislabelled by 1000×. Fixed in
  `opuspopuli-node` / `opuspopuli-node-us-ca` (field renamed `duration_s`); until those images are
  rebuilt and redeployed, **read `duration_ms` in existing logs as seconds.**
- **No off-node copy.** Every snapshot lives on the same machine as the database. A disk or host loss takes both. That is a real single point of failure and is out of scope for this runbook — it needs its own decision.
