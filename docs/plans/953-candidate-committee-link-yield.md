# Plan of record: fix candidate→rep link yield (#953)

| | |
|---|---|
| **Issue** | [OpusPopuli/opuspopuli#953](https://github.com/OpusPopuli/opuspopuli/issues/953) (follows #941, epic #936) |
| **Date** | 2026-08-04 |
| **Author** | Rodney Gagnon (AI-assisted; plan approved in-session) |
| **Data classification** | None — operates on **public civic data** (CAL-ACCESS candidate/committee names, legislator names). No PHI/PII, nothing sent to a model, no end-user data. Not in the CCPA-sensitive surface. |
| **Branch** | `fix/candidate-committee-link-yield-953` |

## Root cause (measured against production, 2026-08-04)

The candidate→rep linker attributed only **5 of 120** legislators. Two independent limiters, quantified via read-only prod queries:

1. **`candidate_name` parse bug.** The linker reduces `candidate_name` via `split(',')[0]`, which only handles `"Last"` and `"Last, First"`. CAL-ACCESS frequently stores `"First Last"` (`Tina McKinnor`), which normalizes to the full name and never matches a rep surname. Last-token extraction: **5 → 44** reps on the office-matched path.
2. **`type='candidate'` eligibility gate.** Many candidate-controlled committees are mis-typed (`type='other'`/`'OTHER'`) and excluded before matching runs. Relaxing eligibility to match on `candidate_name` + ASM/SEN office *regardless of type* — while keeping the `isCandidateOwnCommittee` name-gate for precision — lifts **30 → 111/120**. Empirically the name-gate excludes none of the widened matches (111 with gate = 111 without), i.e. the added `type='other'` committees are genuinely the members' own committees, just mis-typed.

Note: the full rework (reconcile + name-recovery) already exists on `develop` but still contains bug #1 and is **not deployed** to prod (prod runs a partial gate-only build, never re-run). This fix goes on top of the `develop` rework.

## Subtasks

1. **Linker fix** — `apps/backend/src/apps/region/src/domains/candidate-committee-linker.service.ts` (region service):
   - (a) Extract the surname from `candidate_name` handling `"Last"`, `"Last, First"`, and `"First [Middle] Last"`, stripping a trailing generational suffix (`Jr/Sr/II/III/IV/V`) first.
   - (b) Relax eligibility from `type='candidate'` to all `cal_access` committees, keeping `isCandidateOwnCommittee` (surname-in-name + no support/oppose markers) as the precision guard; extend `reconcileExistingLinks` to the same widened set.
   - No schema migration (`representative_id` FK exists); no GraphQL/resolver change (rep-funding panel already reads `representativeId`) → **no federation impact.**
2. **Tests** — extend `candidate-committee-linker.service.spec.ts`: `"First Last"` + suffix names link; a `type='other'` **controlled** committee links; a `type='other'` **support/oppose** committee does **not** link (precision); ambiguous surname still skipped.
3. **Deploy** — rebuild `region` + `region-worker` images → ghcr → pull + restart on the `opuspopuli-us-ca` node.
4. **Re-run the linker on prod** — linker-only trigger (avoid a full ~286k-row finance re-sync); it self-heals stale links via the reconcile pass. *Confirm the trigger mechanism before touching prod.*
5. **Re-verify** — re-run the yield diagnostic (expect ~111/120) and spot-check ~10 newly-linked committees for precision.

## Risk register (severity × likelihood → mitigation)

1. Precision regression from relaxing the type gate — **medium × possible** → `isCandidateOwnCommittee` retained (empirically no false adds); negative precision test; prod spot-check post-run.
2. Re-running the linker mutates prod links — **medium × possible** → idempotent + self-healing reconcile; re-measure + spot-check; safely re-runnable.
3. Full finance re-sync is heavy/expensive — **medium × possible** → run the linker only (subtask 4 pins the mechanism).
4. Suffix/middle-name edge cases in surname extraction — **low × possible** → strip `Jr/Sr/II–V`; unit tests.
5. Deploy/restart of region services — **low × possible** → single-service change, off-peak, revertible; empty-rep-index guard prevents nuking links on a bad load.
6. AGPL / deps — **low × rare** → no new dependencies.

## Effort

~1–1.5 sessions for code + tests; deploy + prod re-run + verify is ops (Studio access available).
