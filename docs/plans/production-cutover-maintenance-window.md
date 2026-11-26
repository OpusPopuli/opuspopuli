# Production cutover — one maintenance window from v1.28.0 to `main`

> **Carried out (recorded 2026-11-26).** Window A ran 2026-11-09 and Window B 2026-11-14 to 15, and the owner reopened the site on 2026-11-15. See `docs/compliance/releases/v2.0.1-validation.md` §5 and `docs/runbooks/window-b-v2.0.1.md`. The status lines below are as they stood at the time. Kept as the record of Window A's findings. Its open items are now issues: #1469 (FEC 403), #1470 (wrong-password message), #1471 (nightly sync), prompt-service#129 (40 templates vs 39) and create-op-node#130 (`verify` CSRF). `FILE_SIZE_LIMIT` was #1447.

| | |
|---|---|
| **Status** | Draft for owner review — 2026-11-08 |
| **Replaces** | the "release-readiness" write-up offered on 2026-11-08; this *is* Phase C2 of `ingestion-resource-lanes.md` §10.4, reshaped around a window |
| **Plans it closes out** | `ingestion-resource-lanes.md` (Phase C), the deployable half of `ai-architecture-roadmap.md` |
| **Production today** | backend `v1.28.0`; frontend last tagged `frontend-v1.13.0` (confirm which run is deployed in Actions) |
| **Gap** | 428 commits and **32 Prisma migrations** on `main` since `v1.28.0` |

## 1. Why a window

Nobody is using the site now that the election is over. Without a window, a
428-commit jump has to stay compatible with the running version at every step:
the backend before the frontend, each migration safe under the old image, each
regeneration live on the serving node. With the site closed, those constraints
go away and what remains is a straight sequence:

> close the site → backup → deploy → load the UAT corpus → verify → open the site

**What the window does not change:**

- **Migrations stay additive.** All 32 already are. That keeps the old images
  able to run on the new schema, which is what makes image rollback (§7) work.
- **Prompts are never inlined**, and both compose files are always layered.
  `./bin/op-deploy` already layers them both.
- **One heavy job at a time on the Studio.** Lane bounds still apply during
  regeneration.

## 1a. Two windows (decided 2026-11-08)

The owner split the cutover in two. **Window A ships the code already tagged.
Window B ships the corpus.**

| | Window A: `v2.0.0` on prod's own data | Window B: `v2.0.1` + the UAT corpus |
|---|---|---|
| **Ships** | backend `v2.0.0`, prompt-service `v0.5.0`, `frontend-v1.14.0` | `v2.0.1` (#1429, G1's model settings, the G4a tool), the §5a transfer |
| **Models** | **Unchanged.** The Studio's `.env` keeps whatever v1.28.0 runs. No model change in the same window as 32 migrations | The D2 models, pinned by digest (N5) |
| **Data** | Prod's existing corpus, migrated in place | Civic tables replaced from UAT (§5a) |
| **Gates** | G5–G7 (done), **G4 without the transfer**: restore the newest prod dump into `restore_drill` (N3) and run `v2.0.0`'s `db-migrate` against it. Record the duration and confirm both data-changing migrations (`20261103120000_finance_ie_cvr2_amendable`, `20261106180000_bill_votes_roll_call`) apply cleanly | G1–G4, G4a, D3a, D3b |
| **Node** | N2, N3, N4, N6, N7 | N5 |
| **Steps** | W1–W7, **skip W8**, W9, W10 | W1–W3, W5–W6 (the `v2.0.1` images), W8, W10 |

**Status 2026-11-09: Window A deployed. The site stays closed until Window B (owner's
decision).** W10 was not run: the owner chose not to reopen on prod's
Sep-16 corpus, so the W1 redirect rule stays on through Window B. That makes
Window B's W1 already done, and its W10 the only reopening.

What Window A actually shipped, and where it departed from the table above:

| | |
|---|---|
| Backend | `2.0.0`, 75 migrations applied. `op-deploy`, so `:previous` = v1.28.0 |
| prompt-service | `0.5.0` (the release build hung ~4 h on QEMU arm64; re-run took 6 min) |
| Frontend | `frontend-v1.14.0` **crashed every route** (Cloudflare 1101): Next 16.4.2 under `@opennextjs/cloudflare` 1.18.0, which does not bundle `preview-props.json`. Its smoke-test failure was misread as the redirect rule. Fixed by #1437 (adapter 1.20.13, wrangler 4.149.0, pinned), shipped as **`frontend-v1.14.1`**, verified by the owner from the allowlisted IP. The smoke test fails with 302 while the rule is on. Expected |
| **Models: changed, against this table's "unchanged"** | Prod's `LLM_MODEL` was `qwen3.6:35b-a3b`, which was **no longer on the Studio**, so every LLM call was failing. Switched `LLM_MODEL` to `nemotron-3.5-lightning:30b-a3b` (`LLM_ANALYSIS_MODEL` follows; `LLM_INGESTION_MODEL` unset), copied byte-for-byte from UAT (manifest `e7a64ff15fb1`, model blob `sha256-5c19f628…`, all five blobs verified). The registry tag had been re-pushed (`29a422b3cf50`, 19 GB), so **never `ollama pull` it on either host**. Studio Ollama upgraded Homebrew 0.x → **0.40.15** (launch-agent env preserved; restart via `launchctl kickstart -k`, not `brew services`). The Mac is still 0.34.3, which is where UAT's evals were measured. This is N5's model pinning done early, by copy rather than digest pull |
| Applied with | `./bin/op-compose … up -d`, not `op-deploy`, to keep `:previous` |
| Sync | The finance sync queued during W6 was cancelled (`cancelRegionSync`); its output would be replaced by the corpus. The 02:00 cron is left on as PQ evidence |
| Not yet checked | A model-backed answer in the live app (first production use of nemotron) |

Found during Window A:

- **Every `up -d` re-runs `db-migrate`'s seed**, not just `op-deploy`. On
  2026-11-09 it skipped the existing admin, but re-wrote
  `SENSITIVE_PROFILE_ENCRYPTION_KEY` to the dev default. Harmless only because
  it already was the dev default. Until `v2.0.1`'s seed fix, never rotate it.
- **Never `--remove-orphans`.** `opuspopuli-backup` (the #1270 scheduler) is
  outside these compose files and shows as an orphan.
- **`create-op-node verify` sends GraphQL without a CSRF token** and fails
  check 3 with 403. Tool bug, not a node fault.
- Open, not blocking: FEC API 403; storage `FILE_SIZE_LIMIT` 50 MB blocks
  bulk-snapshot archiving; region-worker RSS above its 3 GB health threshold
  (limit 6 GB); no sync jobs Sep 16 → Nov 8, so the nightly cron may not be
  firing; `loginUser` returns "An unexpected error occurred." for a wrong
  password; 40 active templates against the seed's 39.

**Window B critical path** (owner decision 2026-11-09: stay closed until it
ships):

1. **G2, #1429.** Fix, then regenerate the affected bill summaries in UAT.
   That regeneration is the longest wait, so it starts first.
2. **G4a, the transfer tool** (§5a.3), built while UAT regenerates.
3. **The seed fix** (no dev-default overwrite of Vault or the admin), in
   `v2.0.1` with 1 and 2.
4. **D3a corpus freeze** (§5a.2), once 1 has finished in UAT.
5. **G4 rehearsal** of the transfer against a copy of prod, with exact user counts.
6. Tag `v2.0.1`, then run the window: W2, W3, W5–W6, W8, the browser checks, W10.

**Window A's G4 (migrate-only rehearsal) — PASSED 2026-11-08**, run by the
owner on the Studio:

| | |
|---|---|
| Snapshot | the 2026-11-08 nightly dump, `restore-db.sh --full` into `restore_drill` |
| Before | 43 migrations (= v1.28.0), `independent_expenditures` 22,142, `cvr2_filings` 223, `bill_votes` 459,826, `users` 18 |
| Migrate | `db-migrate:2.0.0` (`sha256:6d2f47a4…aa78a`), `prisma migrate deploy` + `spatial-indexes.sql` only, guarded to `restore_drill`. **All 32 applied in 15.2 s**; spatial step a clean no-op |
| After | Failed or rolled-back migrations: **none**. Row counts after were not captured (copy dropped first); W6 captures the `ie`/`cvr2` deletion against W3's baseline |

Found along the way:

- **Image tags have no `v`**: `db-migrate:2.0.0`, not `:v2.0.0` (W5 note).
- **The rehearsal ran as `supabase_admin`, not `postgres`.** `restore-db.sh
  --full` restores as `supabase_admin` with `--no-owner --no-acl`, so every
  restored table is owned by it and `postgres` (the app's role) gets
  `permission denied`. None of the 32 migrations creates an extension, type,
  function, grant or role, so the superuser ran exactly the SQL `postgres` will.
  §7's rollback uses `--quick` (restores as `postgres`), so this doesn't change
  Window A. But a `--full` disaster-recovery restore yields a database the app
  can't use, and the 2026-09-16 drill checked row counts, not app access. Filed as
  opuspopuli-node#68.
- **Not run in the rehearsal:** `db-migrate.sh`'s admin-user, storage-bucket and
  Vault seeds. They reach the database through GoTrue, pg-meta and PostgREST,
  so they'd have written to production. They run again at W5. See the
  pre-window production checks.

**Seed defaults in production (found 2026-11-08, pre-dates v2.0.0):**
`db-migrate.sh` seeds an admin account (`admin@opuspopuli.local`, default
password `Admin1234!`) and upserts Vault secrets with dev defaults on every
deploy. Prod had both:

- **The admin account:** created 2026-07-13, the only admin. Every audited use
  traces to the owner's own sync scripts. **Contained 2026-11-08:** the
  password was rotated to a random one, stored in the Keychain as
  `admin-password`. Verified through the public gateway: `Admin1234!` is
  rejected and the new password is accepted. The seed skips existing accounts, so W5 keeps it.
- **`SENSITIVE_PROFILE_ENCRYPTION_KEY` is the public dev key** (1 encrypted
  row). Rotate it **only after** `v2.0.1` stops the seed overwriting Vault.
  Otherwise the next deploy reverts the key and the re-encrypted row can't be
  read.

**Window A, on prod's data:**

- **Reopen criteria (§6) still apply unchanged.** Item 3 matters most: no AI
  explanation may be blank where v1.28.0 had one.
- **The 02:00 cron runs `v2.0.0` against prod's corpus.** The first bills run
  does one full bulk rewrite. That's acceptable: nobody is using the site, and
  it's the production PQ evidence the v2.0.0 pack lacks (EX-4). Its output is
  replaced in Window B anyway. Watch it per W11, one heavy job at a time.
- **Rollback (§7) is unchanged.** The W8 rows don't apply.

## 2. Owner decisions — before scheduling

| # | Decision | Why it blocks | Suggestion |
|---|---|---|---|
| D1 | ~~**End the dev-only phase** (2026-10-26) for this release~~ — **ended 2026-11-08** by tagging `v2.0.0`, `frontend-v1.14.0` and prompt-service `v0.5.0`. `:latest` on ghcr is now v2.0.0, so any Studio `pull` gets it | Tags and Studio deploys are out of scope until it ends | — |
| D2 | ~~Lane models on the Studio~~ — **decided 2026-11-08: prod runs the UAT models.** This supersedes the 2026-11-07 "larger variants on the Studio" standard (`opus-populi-infra-architecture.md` D3) | Pin the **digests** UAT used, not just the tags. A tag can be re-pushed, and the copied rows record the UAT digest | — |
| D3 | ~~Regenerate or transfer~~ — **decided 2026-11-08: ship the UAT civic corpus, keep prod's user data** (§5a) | Replaces W8 regeneration and the ~48 h bills sync | — |
| D3a | **Corpus freeze.** Which UAT state ships, and what has to be clean in it first | The UAT corpus becomes production's. Half-runs, test edits, summary-model failures and #1429 partial-read summaries ship with it | Freeze after G1–G3, at the release's code and models. Quality check per §5a.2 |
| D3b | **Object-storage payloads.** `bulk_snapshots` rows point at objects in local storage that a DB dump doesn't carry | Without them the rows read "payload missing": finance provenance names the snapshot but can't re-read it | Copy the bucket. Accepting `payload_missing_at` is the fallback the schema already models |
| D4 | **Reopen criteria** (§6) | — | Reopen when §5a.4 and W6 pass. No regeneration runs in the window any more |
| D5 | **R6 (#1208/#1209) in or out** | Scope creep: "it's a big release anyway" (`ingestion-resource-lanes.md` §10.5) | Out, unless it is already on `main` |
| D6 | **#1429** (partial-read bill summaries are stored) before the window, or after | A known-bad output would ship and then be regenerated | Fix it before. Bills regenerate last anyway |
| D7 | ~~**How the site closes** (§5, W1)~~ — **decided and built 2026-11-08:** a Cloudflare redirect rule to `opuspopuli.org/maintenance/` (N7) | A frontend code change needs a deploy to close and another to reopen | A Cloudflare rule. Nothing to deploy, and it lifts in one click |

## 3. Code-side gates — on `main` and in local UAT, before tagging

> **2026-11-08:** `v2.0.0` was tagged before G1–G4 closed. Whatever they
> change in code (G1's model cutover, G2's #1429 fix, G4a's transfer tool)
> ships as `v2.0.1`, and the window deploys that tag, not `v2.0.0`.

| # | Gate | Evidence |
|---|---|---|
| G1 | **Phase C1 model cutover** per lane, on UAT, with eval parity (`ingestion-resource-lanes.md` §10.3). #1233 is re-measured if petition verification is touched | Eval harness output recorded in the plan |
| G2 | #1429 fixed (D6) | PR merged |
| G3 | **Release candidate in local UAT end to end:** migrations from a v1.28.0-shaped DB, one sync per data type, the frontend against it | UAT notes in this doc |
| G4 | **Full rehearsal against a copy of production, on the Studio.** Restore the latest prod dump into a scratch DB (as in `docs/runbooks/restore-drill.md`), run the RC's `db-migrate` against it, then run the §5a transfer into it. Record durations, row counts and every user reference remapped or dropped | Rehearsal table in this doc |
| G4a | **The transfer tool** (§5a.3), built and tested with the #1305 script as the reference pattern. Never hand-written psql | PR merged, tests mutation-checked |
| G5 | ~~`/op-release`: changelog, notes, evidence pack. `/op-review` and `/op-security` on the release diff. The federation check at the gateway~~ | **Done 2026-11-08:** #1436, `docs/compliance/releases/v2.0.0-validation.md`; GitHub Releases `v2.0.0`, `frontend-v1.14.0` |
| G6 | ~~**prompt-service release** with every template the RC calls. Its `prisma/seed.ts` is the source of truth~~ | **Done 2026-11-08:** prompt-service #126, tag `v0.5.0`. What prod runs is still unconfirmed (§9) |
| G7 | ~~The `@opuspopuli/regions` version pinned in the image~~ | **Done:** exact `1.0.108` in `packages/region-provider/package.json` at `v2.0.0` |

## 4. Node prerequisites — days before, production unaffected

None of these restarts a running container. Do them over SSH at any time, and
tick them off here.

| # | Step | How | Notes |
|---|---|---|---|
| N1 | ~~**Restore the Keychain secrets** lost in the 2026-11-01 reset~~ — **not needed (2026-11-08):** `jwt-secret` is present in the login Keychain, so they weren't lost. The first `op-compose pull` (N5 or earlier) confirms the rest, because `require_secret` fails on any that's missing | Copy each from the running container's env with `security add-generic-password -s org.opuspopuli.us-ca -a <account> -w`, without printing values. The account list is in `bin/op-compose` | Until this is done `op-compose` can't `pull` or `up`, and nothing below works. Check with `security find-generic-password -s org.opuspopuli.us-ca -a jwt-secret` |
| N2 | ~~**Backups running again** (#1217)~~ — **done 2026-09:** backups resumed ~09-11, `BackupStale`/`BackupMissing`/`BackupFailing` alerts added in #1270 and node-us-ca#40. **Confirmed 2026-11-08:** a Nov 8 dump is present (`docker exec opuspopuli-backup ls -lt /backups \| head -5`) | Create `.env.backup.prod` from `.env.backup.example` (`BACKUPS_DIR_HOST`), then `./bin/op-compose -f docker-compose-prod.yml -f docker-compose-backup.yml up -d opuspopuli-backup` | `op-deploy` leaves the backup overlay out on purpose. A redeploy or reboot has stopped backups before, silently |
| N3 | **Restore drill** on the newest dump. The last drill passed on 2026-09-16 (226 s, `restore-drill.md` §7); this run is mainly the vehicle for Window A's migration rehearsal (§1a) | `docs/runbooks/restore-drill.md` §2–6 (`--full` into `restore_drill`, compare counts, drop it) | A dump that hasn't been restored isn't a backup |
| N4 | ~~**Host memory probe**~~ — **done 2026-11-08:** `verify` shows the probe at 83.0 GiB reclaimable, and `OLLAMA_MAX_LOADED_MODELS=3` matches the gate. `verify`'s GraphQL check fails with `403 CSRF token required` because it sends no CSRF token; GraphQL itself works (the admin login check went through it) | `./scripts/host-memory-probe/install.sh`, then `npx create-op-node@0.22.0 verify --repo-dir .` | Inert until the RC runs. **Required before W5**: the RC's gate fails closed without it |
| N5 | **Pull the D2 models** | `ollama pull <model>` | Pulling doesn't load a model. Check the Docker VM disk and host disk first |
| N6 | ~~**Docker VM disk headroom**~~ — **done 2026-11-08:** 211 GB free of 322 GB (31% used). The containers also reach the probe (`host.docker.internal:11500` answers from `region-worker`) | `docker exec opuspopuli-db df -h /` | `op-deploy` prunes after the deploy, not before. The VM disk filled up on 2026-08-12 |
| N7 | ~~**Maintenance page ready**~~ — **done 2026-11-08.** Dashboard redirect rule `W1 maintenance: california app` tested scoped to `/terms`: `/terms` 302 → `/maintenance/`, `/` 200, API `/health` 200. **Widened 2026-11-08 by the owner: the site is closed to everyone except the owner's home network**, so W1 is effectively done early. Reopen (W10) is turning the rule off. Earlier notes: `opuspopuli.org/maintenance`, EN+ES, noindex: opuspopuli.org#18 (after #17, the Astro 7 upgrade its security scan required). **Page live 2026-11-08** (HTTP 200, noindex). No Terraform manages the zone's redirect rules, so the W1 rule is a dashboard rule. Still to do: create it scoped to `/terms`, test it, then disable it until W1 | §5, W1 | Build it and test it on one path first |

## 5. The window

Allow one working day for W1–W10, plus the background regeneration in W11.
The Studio needs someone at the machine for the whole window: a reboot stops at
the FileVault prompt, and the Keychain re-locks.

```bash
ssh -t opuspopuli@opuspopuli-us-ca
security unlock-keychain ~/Library/Keychains/login.keychain-db
cd /Volumes/OpusPopuli/Development/opuspopuli-node-us-ca
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
```

### W1 — Close the site

**A Cloudflare rule on `california.opuspopuli.org`, not a code change.** The
frontend is a Worker on a custom domain (`apps/frontend/wrangler.toml`), and
Cloudflare evaluates its rules before the Worker runs. Two options:

- **Redirect rule** (any plan): `california.opuspopuli.org/*` → 302 to a
  static maintenance page, e.g. `opuspopuli.org/maintenance`. That page has to
  exist on the Astro landing site first (N7).
- **WAF custom rule with a custom response**, if the plan allows it: 503 with
  `Retry-After`, which tells search engines the outage is temporary.

**Test the rule** on one path (`/terms`) before widening it to `/*`, and check
that `api-us-ca.opuspopuli.org` is unaffected. **Reopening (W10) is deleting
the rule.**

### W2 — Stop writes

Writes to stop before the backup: `region-worker` (daily 02:00 cron) and the
other workers, so no sync runs during the dump.

```bash
./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml \
  stop region-worker structural-analysis-worker llm-rerank-worker
```

The site is closed, so users can't write either. Leave the database, Redis
and the gateway running.

### W3 — The backup this window rolls back to

```bash
docker exec opuspopuli-backup /scripts/backup-db.sh
docker exec opuspopuli-backup /scripts/backup-prompts-db.sh
ls -lah /Volumes/OpusPopuli/backups/ | tail -4
```

Then capture the baseline counts (`restore-drill.md` §3 query) and paste them
here. **Don't go past W3 without a dump from this window that N3 has proven
restorable.**

### W4 — prompt-service

Deploy the G6 release and seed it. **Don't restart `opuspopuli-prompts` after
seeding**: its boot re-seeds from the image and can overwrite newer template
text while leaving the version number alone. Check versions and lengths
against `prisma/seed.ts`.

### W5 — Backend

~~Tag on `main` and wait for `release.yml` to publish images~~. **Done
2026-11-08:** `v2.0.0` is tagged and its images are published as `:latest`.
On the Studio:

```bash
./bin/op-deploy
```

`op-deploy` tags the running images `:previous` (the rollback point), pulls,
and recreates with **both** compose files. `db-migrate` runs the 32 migrations
before region starts.

**Use `op-deploy` as is, not `TAG=v2.0.0 ./bin/op-deploy`.** With `TAG` set it
tries to save `:v2.0.0` as `:previous`, finds nothing to save, and the rollback
point is lost. Note also that the images carry **no `v` prefix**:
`release.yml` publishes `2.0.0`, `sha-073133a` and `latest`, so `:v2.0.0`
doesn't exist (found in the 2026-11-08 rehearsal). Pin with `TAG=2.0.0` when
you need a fixed version.

### W6 — Verify the backend

1. **Migrations.** `select count(*) from _prisma_migrations where finished_at
   is not null and rolled_back_at is null` should be the previous count + 32.
   No row should have `rolled_back_at` set.
2. **Raw-SQL indexes** are still present: the 7-index query in
   `docs/runbooks/release-v1.21.0.md` step 2 (#1168).
3. **Health.** `docker compose ... ps`: every service `healthy`.
   `requirePromptServiceUrl` refuses to boot without the overlay, so a missing
   service is a finding, not noise.
4. **Host memory gate.** The `llm_host_gate_total` counter in Prometheus shows
   `admitted`. Any `probe_unreachable` means N4 isn't done.
5. **GraphQL smoke from the workstation.** The CSRF cookie dance in
   `release-v1.21.0.md` step 2. Run `regionSearch` plus one query per data type
   the frontend reads.

**Stop here if any check fails.** The site is closed and the old images are
tagged, so a failure costs nothing yet. Roll back (§7).

### W7 — Writes resume

W5's `up -d` restarts the workers W2 stopped, so writes resume with the
deploy. That's acceptable: the site is closed, and the workers only run
scheduled or enqueued jobs. If W6 fails, stop them again before rolling back.
Check that they're `Up`, and that no startup sync job was queued that you
didn't intend (`docker logs opuspopuli-region-worker --tail 50`).

### W8 — Load the UAT corpus

Stop the workers again first: W5 restarted them, and a sync running while the
corpus is replaced would write into a half-loaded set of tables. Then run
§5a.3 against `postgres`, exactly as rehearsed in G4. Its counts have to match
the rehearsal. Then:

```bash
docker exec opuspopuli-redis-cache redis-cli FLUSHALL   # the app cache, not BullMQ's redis
```

Restart the workers only after §5a.4 passes.

### W9 — Frontend

`frontend-v1.14.0` is already tagged (2026-11-08), and its Deploy Frontend run
is waiting. Approve the `production` environment on that run. The site is
still closed by W1's rule, so the new Worker serves nobody yet. Test it with
the rule scoped to exclude your own IP, or through a preview URL.

### W10 — Open

Delete the W1 rule. Then, on the live site:

- the home page, the region page and one detail page per data type;
- search, both the typeahead **and** full results (#1182);
- sign-in with a passkey, and with a magic link (checks email DNS);
- watch for Error 1102 (`wrangler tail`).

### W11 — After reopening, in the background

- Nightly syncs resume from the UAT corpus's watermarks. Watch the first run of each data type: it should find little to do.
- Confirm the backup scheduler ran the next night (`ls` the backups
  directory). That counts as the alerting half of #1217 until real alerting
  exists.
- Restart Prometheus if the new exemplar flag (`ingestion-resource-lanes.md`
  §3) is part of this release.
- Remove the maintenance page from the landing site.
- Update the memory notes and this doc's status table with what shipped.

## 5a. Shipping the UAT corpus while keeping prod's user data (D3)

### 5a.1 What moves and what stays

The split follows the bounded contexts: user-owned rows stay, civic rows are
replaced.

| Kept from **prod** (user data and its history) | Replaced from **UAT** (the civic corpus) | Dropped, then regenerated |
|---|---|---|
| `users`, `user_profiles`, `signal_profiles`, `sensitive_profiles`, `user_addresses`, `user_jurisdictions`*, `user_logins`, `user_sessions`, `passkey_credentials`, `webauthn_challenges`, `user_consents`, `notification_preferences`, `user_events`, `email_correspondence`*, `documents`, `document_propositions`*, `abuse_reports`, `audit_logs`; every non-`public` schema (`auth`, `storage`, `vault`) | Bills and `pubinfo_*`, propositions, representatives and committees, meetings and minutes, civics, glossary, every campaign-finance table, `claims`, `evidence`, `claim_*`, `source_versions`, `bulk_snapshots`, `bulk_imports`, `pipeline_*`, `structural_*`, `ingestion_watermarks`, jurisdictions, county tables, `region_plugins` | `bill_`, `proposition_`, `representative_` and `committee_relevance_cache`, `briefing_summary_cache`, `personalized_impact_cache`, `llm_rerank_jobs`. These are per-user caches over civic rows, rebuilt on demand |

`prompt_templates` is neither. It's a seed table, re-seeded by the deploy.

\* **References into the civic corpus that must be remapped.** Civic primary
keys are UUIDs that differ between the two databases (#1305 measured
propositions and representatives; minutes happened to match). So a user row
pointing at a prod civic UUID points at nothing after the swap, or worse:

| Reference | Kind | What happens without a remap |
|---|---|---|
| `document_propositions.proposition_id` | FK, **`ON DELETE CASCADE`** | Deleting prod's propositions **silently deletes users' petition-scan links** |
| `user_jurisdictions.jurisdiction_id` | FK, no action | Deleting prod's jurisdictions **fails**, which is the safe failure |
| `email_correspondence.representative_id` / `proposition_id` | soft (no FK) | Dangling: a user's sent-email history loses its subject |
| `user_events.object_id`, `audit_logs.entity_id` | soft, polymorphic | Dangling. **Left as is**: they record what happened, against IDs that were valid at the time |

The remap keys on natural keys, the way #1305 does: `external_id` (plus
`region_plugin_name` for propositions), and the jurisdiction's own identifier.
A reference that finds no match is **reported, not dropped**. The tool refuses
to finish while any CASCADE reference is unmatched.

### 5a.2 Freezing the UAT corpus (D3a)

Before exporting:

1. The release's code and models produced it: G1–G3 done, pinned digests
   recorded.
2. Per data type: no rows in a failed or partial state (summary-model
   failures, #1429 partial reads, `payload_missing_at` set), and no pipeline
   job left `running`.
3. Finance verified against the raw archive, never `items_extracted`
   (`project_finance_data_correctness`).
4. The prompt-service version that produced it is the one W4 deploys. Every
   `promptHash` in the corpus resolves in prod's prompt-service; otherwise the
   attestation chain (#1143) points at prompts prod doesn't have.
5. Record the freeze: row counts per table and content hashes, pasted here.

### 5a.3 The transfer tool (G4a)

A script in `scripts/`, modelled on the #1305 transfer. It runs in the region
image so it uses the app's own Prisma client and schema. In outline:

1. **Export** (dev machine): `pg_dump --data-only` of the civic tables only.
   No user table leaves UAT. UAT has dev accounts that must never reach
   production.
2. **Import** (Studio), in one transaction:
   - Build the remap: for each prod civic row a user table references, record
     its natural key.
   - Drop the regenerable caches.
   - Load UAT's civic rows into staging tables, so prod's civic tables are only
     touched once everything has loaded.
   - Repoint the user references through the remap, and refuse on any
     unmatched CASCADE reference.
   - Replace the civic tables from staging. Never use `TRUNCATE ... CASCADE`:
     its cascades would empty the user tables.
   - **Bill summaries ship only with full provenance** (#1429 D3, decided
     2026-11-09). A bill keeps `aiSummary` and its `aiSummary*` columns only
     when `aiSummaryPromptHash` and `aiSummaryLlmDigest` are set and
     `aiSummarySourceVersion` equals the bill's current pubinfo version.
     Otherwise those columns are cleared in staging, so the bill arrives
     `MISSING` and is summarized on first read. UAT measured 21 of 4,456 that
     qualify; 4,239 are July summaries with no provenance. Report the counts
     kept and cleared.
   - Verify the counts against the freeze record (§5a.2 step 5), then commit.
3. **Report**: counts per table, references remapped, unmatched references.
   Never user content.

Rehearse it in G4 against a copy of production, then run it once in W8. The
rehearsal's report is the expected output for W8.

### 5a.4 Verification after the load

- The counts per table match the freeze record.
- Every user, passkey and address count matches the W3 baseline exactly. **A
  single user row lost is a rollback (§7).**
- No `document_propositions` row was lost.
- Every `promptHash` in claims and analyses resolves in prod's prompt-service.
- One signed-in user sees their address, jurisdictions and petition scans.

### 5a.5 What this costs, and what it gives up

- **No in-window regeneration and no 48 h bills sync.** The window becomes:
  deploy, load, verify.
- **The UAT corpus becomes the source of truth.** Anything wrong in it ships,
  which is why D3a matters more than any step in §5.
- **Personal data stays on the Studio.** Prod user data never comes to the
  dev machine, and dev accounts never go to prod. This keeps the CCPA posture
  `.sdlc/compliance-profile.yaml` declares.
- **Object-storage payloads** need a separate copy (D3b).

## 6. Reopen criteria (D4)

Open the site when all of these hold:

1. W6 is all green.
2. Every page the frontend links from the home page renders with data, not an
   empty state, for the region.
3. No AI explanation is blank where v1.28.0 had one. This catches a repeat of
   the 2026-08-17 prompt-service blanking.
4. Search returns results.

Nothing is regenerated in the window: the corpus arrives finished (§5a).
Those run while the site is live.

## 7. Rollback

| Failed at | Do | Data loss |
|---|---|---|
| W1–W4 | Delete the W1 rule. Nothing else has changed | None |
| W5–W6, **schema fine** | `TAG=previous ./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml up -d`, then reopen | None. The 32 migrations are additive, and v1.28.0 ignores new columns |
| W5–W6, **migration half-applied or data wrong** | Restore the W3 dump (`restore-db.sh --quick`, reading the target line, not passing `--yes`), then the `:previous` images | None. Writes were stopped at W2 |
| W8, the transfer fails | It runs in one transaction, so a failure leaves prod's corpus untouched. Fix the cause, rehearse again (G4) | None |
| W8 passed, but §5a.4 finds a problem | Restore the W3 dump, then the `:previous` images | None. Writes were stopped at W2 |
| W9–W10, frontend | Re-run Deploy Frontend at the previous `frontend-v*` tag. If the backend is rolled back, roll the frontend back too | None |

The **prompt-service** rollback is `PROMPTS_TAG=previous` with the same
command. Its database is restored from `backup-prompts-db.sh`'s W3 dump.

## 8. Risks

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| A migration is slow or locks on prod-sized data (18M contributions) | high × possible | G4 dry run against a prod copy, with timings recorded |
| The backup can't be restored | high × possible (it has silently stopped before) | N3 drill, plus W3's fresh dump |
| Secrets missing at W5 | high × certain if N1 is skipped | N1 is a hard prerequisite |
| The gate defers every model load | high × certain if N4 is skipped | N4. W6 step 4 catches it |
| The corpus transfer drops or orphans user data | **high** × possible | §5a.1 remap, refusal on unmatched CASCADE references, G4 rehearsal, §5a.4 exact user counts |
| A UAT defect ships as production data | high × possible | D3a freeze checks |
| Prompt hashes in the corpus don't resolve in prod | medium × possible | §5a.2 step 4; W4 deploys the same prompt-service version |
| An unattended reboot mid-window | medium × rare | Someone at the machine for the window |
| A prompt-service restart overwrites newer templates | medium × possible | W4: never restart after seeding |
| Scope grows | medium × likely | D5. Only what is on `main` at the G5 tag ships |

## 9. Not verified from here

Production reads are denied in this session, so these are taken from memory
notes and need confirming on the Studio during §4:

- which `frontend-v*` is actually deployed;
- the prompt-service version prod runs;
- whether the Keychain secrets are still missing (as of 2026-11-01);
- whether the backup container exists;
- which Ollama models are present;
- Docker VM disk usage;
- the `_prisma_migrations` count today.

## 10. Effort

| Part | Estimate |
|---|---|
| D1–D7 | One conversation |
| G1 Phase C1 model cutover and evals | ~1–2 sessions |
| G2 #1429 | ~½ session |
| G3–G7 | ~1–2 sessions |
| N1–N7 | ~½ day at the Studio |
| W1–W10 | One working day |
| G4a transfer tool, tests, rehearsal | ~1–2 sessions |
| D3a corpus freeze and checks | ~1 session |
| W11 | Routine nightly syncs only |
