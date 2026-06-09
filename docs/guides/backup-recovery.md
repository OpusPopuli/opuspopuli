# Backup and Recovery

This guide covers the daily backup and disaster recovery procedures
for the opuspopuli PostgreSQL database. It assumes you have a
running opuspopuli stack — see [Getting Started](./getting-started.md)
for stack setup.

## Architecture overview

A dedicated `opuspopuli-backup` container runs alongside the main
stack as an overlay. It uses an in-container scheduler (supercronic)
to fire a daily `pg_dump` at 03:00 (operator timezone) and writes
gzipped custom-format snapshots to a host filesystem path you choose.

The overlay is environment-agnostic — the same `docker-compose-backup.yml`
file works against local dev, UAT, and Mac Studio production. Only
the values in `.env.backup` differ per environment.

```
opuspopuli-backup container
   ├── supercronic (scheduler) — fires daily at 03:00
   ├── scripts/backup-db.sh    — pg_dump + gzip + retention
   ├── scripts/restore-db.sh   — operator-triggered restore
   └── bind mount → ${BACKUPS_DIR_HOST}/  (snapshots live here)
```

## One-time setup (per environment)

### 1. Create the backup destination directory

The directory must exist on the host and be writable by the user
running docker.

```bash
# Local dev — typically the external SSD
mkdir -p /Volumes/OpusPopuli/Development/db-backups

# Mac Studio production
mkdir -p /Users/opuspopuli/backups
```

### 2. Configure environment variables

```bash
cp .env.backup.example .env.backup
$EDITOR .env.backup
```

Required variables:

| Variable | What to set |
|----------|-------------|
| `BACKUPS_DIR_HOST` | The directory you just created |
| `GIT_SHA` | Output of `git rev-parse HEAD` (lets restore detect schema drift) |

Recommended:

| Variable | Local dev | UAT | Production |
|----------|-----------|-----|------------|
| `RETENTION_DAYS` | `7` | `14` | `30` |
| `TZ` | `America/Los_Angeles` | `America/Los_Angeles` | `America/Los_Angeles` |

See [`.env.backup.example`](../../.env.backup.example) for the full
contract including optional overrides.

### 3. Bring up the backup service

The overlay is brought up alongside whichever app stack is already
running. The command pattern is the same across environments — only
the app-stack compose file changes.

```bash
# Local dev (against the default docker-compose.yml)
docker compose -f docker-compose.yml \
               -f docker-compose-backup.yml \
               --env-file .env.backup \
               up -d opuspopuli-backup

# UAT
docker compose -f docker-compose-uat.yml \
               -f docker-compose-backup.yml \
               --env-file .env.backup \
               up -d opuspopuli-backup

# Mac Studio production
docker compose -f docker-compose-prod.yml \
               -f docker-compose-backup.yml \
               --env-file .env.backup.prod \
               up -d opuspopuli-backup
```

Verify the scheduler started:

```bash
docker logs opuspopuli-backup
# Expected first line:
# {"ts":"...","event":"scheduler_start","crontab":"0 3 * * * /scripts/backup-db.sh;"}
```

The backup service is now running. The first scheduled snapshot
will fire at 03:00 in the configured timezone.

## Daily automated backup

The scheduler runs `backup-db.sh` once per day at 03:00 in
`${TZ}`. Each run:

1. Acquires a `flock` on `${BACKUPS_DIR_HOST}/.backup.lock` (prevents
   overlap with ad-hoc backups or restores)
2. Runs `pg_dump --format=custom --no-owner --no-acl` against
   `opuspopuli-db`, piping through `gzip -9` to a `.partial` file
3. Atomically renames the `.partial` → final filename:
   `opuspopuli-db-<git_sha>-<UTC_timestamp>.dump.gz`
4. Deletes snapshots older than `RETENTION_DAYS`
5. Appends a structured JSON log line to both container stdout AND
   `${BACKUPS_DIR_HOST}/backup.log`

### Watching the daily run

```bash
# Live scheduler output (no other noise)
docker logs -f opuspopuli-backup

# History (queryable with jq)
tail -f /Volumes/OpusPopuli/Development/db-backups/backup.log | jq -c .

# Recent successful backups
jq -c 'select(.status == "ok") | {ts, file, bytes, duration_ms}' \
   /Volumes/OpusPopuli/Development/db-backups/backup.log | tail -7
```

### What success looks like

```json
{
  "ts": "2026-06-08T10:00:00Z",
  "event": "backup",
  "status": "ok",
  "file": "opuspopuli-db-8b0cb16-20260608T100000Z.dump.gz",
  "bytes": 3852177,
  "duration_ms": 4129,
  "git_sha": "8b0cb16",
  "retention_days": 7,
  "retention_purged": 1
}
```

### What failure looks like

```json
{
  "ts": "2026-06-08T10:00:00Z",
  "event": "backup",
  "status": "error",
  "reason": "pg_dump_or_gzip_failed",
  "stderr": "..."
}
```

Other reasons you might see: `dest_not_writable` (host directory
permissions changed), `lock_held` (a previous run is still in
flight — usually self-resolving), `retention_prune_failed`
(non-fatal; backup itself succeeded, retention sweep didn't).

## Ad-hoc backup (on demand)

Run a backup outside the scheduled time — useful right before risky
operations, immediately after a meaningful sync completes, or for a
"snapshot what we have right now" moment:

```bash
docker compose -f docker-compose-uat.yml \
               -f docker-compose-backup.yml \
               --env-file .env.backup \
               run --rm opuspopuli-backup /scripts/backup-db.sh
```

This shares the same lock as the scheduled run. By default it
blocks until any in-flight scheduled backup finishes. To fail
fast instead, set `BACKUP_LOCK_WAIT=false` in `.env.backup`.

The resulting snapshot lands in the same `${BACKUPS_DIR_HOST}`
directory with the same naming shape as scheduled runs — there's
no distinction once written.

## Restore

> **Restore is destructive.** It drops all data currently in the
> target database and replaces it with the snapshot's contents.
> Both modes prompt for confirmation unless `--yes` is passed.

### Pick a mode

| Mode | When to use | Behavior |
|------|-------------|----------|
| `--quick` | Snapshot's `git_sha` matches your current code | `pg_restore --clean --if-exists` in place |
| `--full` | Snapshot is older than current code (schema may have drifted) | Drop + recreate DB, restore from snapshot, operator runs migrations afterward |

The script extracts the snapshot's `git_sha` from the filename and
warns you if it doesn't match `${GIT_SHA}` from the env. When in
doubt, use `--full`.

### `--quick` restore (matching schema)

```bash
docker compose -f docker-compose-uat.yml \
               -f docker-compose-backup.yml \
               --env-file .env.backup \
               run --rm opuspopuli-backup \
               /scripts/restore-db.sh --quick \
               /backups/opuspopuli-db-8b0cb16-20260608T100000Z.dump.gz
```

Behind the scenes: `gunzip | pg_restore --clean --if-exists` against
the current database. Existing tables get cleared row-by-row before
the restore data lands. Fast — typically under a minute for a
sub-GB snapshot.

### `--full` restore (schema may have drifted)

```bash
docker compose -f docker-compose-uat.yml \
               -f docker-compose-backup.yml \
               --env-file .env.backup \
               run --rm opuspopuli-backup \
               /scripts/restore-db.sh --full \
               /backups/opuspopuli-db-1d4e5f2-20260520T100000Z.dump.gz
```

Behind the scenes:
1. Terminate all other connections to the target DB
2. `DROP DATABASE` + `CREATE DATABASE` (against `template1`)
3. `gunzip | pg_restore` schema + data into the empty target

If the snapshot's git_sha is older than current, the script prints
a follow-up command for you to bring the schema forward:

```bash
docker compose -f docker-compose-uat.yml run --rm db-migrate
```

Run that after the restore completes. New columns added in
migrations since the snapshot was taken will get their defaults;
any data backfills required by migrations must be re-applied
manually.

### Skipping confirmation prompts

For scripted use (e.g. an automated regression test that round-trips
backups), add `--yes`:

```bash
... run --rm opuspopuli-backup \
    /scripts/restore-db.sh --quick --yes /backups/...
```

## Verification checklist (after restore)

Sanity-check the restored DB before resuming app traffic:

```bash
# 1. Container connects to the DB
docker exec opuspopuli-db psql -U postgres -d postgres -c "SELECT 1;"

# 2. Row counts look reasonable
docker exec opuspopuli-db psql -U postgres -d postgres -c "
  SELECT 'representatives' AS t, COUNT(*) FROM representatives
  UNION ALL SELECT 'bills', COUNT(*) FROM bills
  UNION ALL SELECT 'meetings', COUNT(*) FROM meetings;"

# 3. Latest content recency matches the snapshot's age
docker exec opuspopuli-db psql -U postgres -d postgres -c "
  SELECT MAX(updated_at) FROM bills;"

# 4. The schema matches what you expect
#    For --full restores against an older snapshot, this should
#    match the snapshot's git_sha BEFORE you run migrations.
docker exec opuspopuli-db psql -U postgres -d postgres -c "
  SELECT version FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1;"
```

## Disaster recovery — full machine loss

This guide covers the database side. For total machine loss (Mac
Studio fails, lost in transit, etc.):

1. **Acquire replacement hardware** — Mac Studio or equivalent
2. **Install macOS + Docker Desktop** to a usable state
3. **Restore the latest snapshot** from off-site backup (currently
   manual; R2 sync is a deferred feature)
4. **Clone the repo + check out the appropriate branch**
5. **Restore `.env` files** from your secrets vault (see [`auth-security.md`](./auth-security.md))
6. **Bring up the stack** per [Getting Started](./getting-started.md)
7. **Run a `--full` restore** of the snapshot against the fresh DB
8. **Apply any migrations** post-snapshot if needed

The bottleneck in this flow is step 3 (off-site retrieval) — see
the "What's NOT yet automated" section below.

## What's NOT backed up and why

| Data | Why not | What to do if you need it back |
|------|---------|--------------------------------|
| Redis | Cache layer; rebuilds from DB on first read | Nothing — it self-heals |
| Ollama models | Re-downloadable from registry | `ollama pull qwen3.5:9b` |
| Build cache, node_modules | Reproducible from lockfile | `pnpm install` |
| Docker images | Reproducible from `docker compose build` | Rebuild |
| `.env` files | Secrets; should be in a vault, never in git | Restore from secrets manager |
| Cloudflare R2 objects | R2 itself provides 11 nines durability | No action needed |

## What's NOT yet automated (known gaps)

| Gap | Why deferred | Tracking |
|-----|--------------|----------|
| R2 off-site sync of snapshots | Gated on Vault-first secrets refactor (#811) so the credential path stays clean | Will file follow-up after #220 lands |
| At-rest encryption of snapshots | Civic data is currently public; encryption matters once real-user PII lands | v1.1 |
| Backup-restore round-trip integration test in CI | Separate scope; needs CI Postgres harness | v1.1 |
| Multi-tier retention (weekly + monthly tiers) | Daily-only is sufficient at current DB size + retention window | File if disk pressure emerges |
| Time Machine setup automation | Out of scope for a code repository; document operationally | N/A |

## Troubleshooting

### "BACKUPS_DIR_HOST must be set" at `docker compose up`

You forgot to pass `--env-file .env.backup`, OR `.env.backup` doesn't
define `BACKUPS_DIR_HOST`, OR the value is empty. This is a fail-fast
guard, not a mysterious bug. Fix the env var.

### Scheduled backup never fires

Check the scheduler is alive:

```bash
docker ps --filter "name=opuspopuli-backup"
docker logs opuspopuli-backup | grep scheduler_start
```

If the container's `Status` shows `Restarting`, look at logs for the
crash reason. Most common: bind-mount path doesn't exist on host
(create it), or `POSTGRES_PASSWORD` doesn't match what the DB expects.

### Snapshot files are owned by root on host

The supabase/postgres image runs as the `postgres` user, but bind-mount
file ownership reflects the container UID, not your host UID. On Mac
this is usually invisible because the Docker Desktop volume sharing
remaps UIDs. On Linux hosts you may need `chown` after each snapshot
or to run the container as your host UID.

### `--full` restore says "snapshot git_sha is older than current"

Expected. After the restore completes, the message tells you to run:

```bash
docker compose -f docker-compose-uat.yml run --rm db-migrate
```

That brings the schema forward from snapshot-era to current-head.
Any data backfills in those migrations need manual review.

### "lock_held" in scheduler logs

A previous run is still in flight, OR a stale lockfile exists.
Check process state:

```bash
docker exec opuspopuli-backup pgrep -af pg_dump
```

If no `pg_dump` is running, remove the stale lockfile:

```bash
rm /Volumes/OpusPopuli/Development/db-backups/.backup.lock
```

## See also

- [`backup/README.md`](../../backup/README.md) — developer-facing details about the backup service itself
- [`docker-compose-backup.yml`](../../docker-compose-backup.yml) — the overlay definition
- [`.env.backup.example`](../../.env.backup.example) — env var contract
- [Database Migration guide](./database-migration.md) — for the migration step in `--full` restores
- [Docker Setup guide](./docker-setup.md) — for general stack troubleshooting
