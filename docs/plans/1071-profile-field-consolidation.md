# Plan: Consolidate the duplicated profile fields

| | |
|---|---|
| **Issue** | [#1071](https://github.com/OpusPopuli/opuspopuli/issues/1071) |
| **Date** | 2026-08-26 |
| **Author** | Rodney Gagnon (plan drafted by Claude, approved by Rodney) |
| **Data classification** | **CCPA/CPRA personal information (`ca-personal-information`).** Active families per `.claude/compliance-profile.yaml`: `us-state-privacy`, `soc2`. `hipaa` inert. Income, housing, household, education, occupation and political affiliation are all § 1798.140(v) personal information, plus the inferences category. The migration touches `user_profiles`, `signal_profiles` and the **encrypted** `sensitive_profiles` payload. Net effect is data minimisation — plaintext duplicates are removed. |
| **Migrations** | **Yes — two-phase, deprecate then remove.** Backfill is additive; column drops ship in a separate PR after the schema change is deployed. No new dependencies (AGPL-safe). |
| **Federation** | `UserProfile` / `UpdateProfileInput` shrink — subgraph schema change, gateway composition must be validated. |
| **Branch** | `fix/profile-field-consolidation-1071` |
| **Effort** | ~6 focused sessions (2.5–3 days); migration and backfill dominate |
| **Status** | Approved 2026-08-26. |

## One line

Retire the Settings demographic/civic block — eight questions that are asked
twice, answered into a store nothing reads, and already collected by
onboarding — and make Your Model the single place each question lives.

## Context (traced 2026-08-26, recorded in #1071)

Every one of the eight `UserProfile` demographic/civic fields has **exactly one
consumer**: the profile-completion percentage at `profile.service.ts:110–119`.
Verified by grepping each field name across `apps/` and `packages/`, excluding
declarations, DTOs, models and the form itself.

Their Your Model counterparts are what actually drive relevance —
`housingTenure` → `isRenter`/`isHomeowner`, `interestTags` → proposition scoring
Axis 2, `incomeBand` → `isLowIncome`, and so on. So a user who sets
**Housing Status = Rent** in Settings gets no `isRenter` flag; ranking is
unchanged while the completion meter rewards them for answering.

The overlap was known. `packages/relationaldb-provider/prisma/schema.prisma:261`
records it and calls consolidation "a planned follow-up" that was never filed.
What that note does not say is that the duplicates are user-facing and inert.

**The finding that settles the direction:** onboarding *already* writes
SignalProfile. `LifeContextStep` writes `housingTenure`, `employmentStatus`,
`studentLevel`, `primaryTransitMode`; `TopicsStep` writes `interestTags`;
`VeteranStep` writes `veteranStatus`. Every user completes this flow. The
Settings block is therefore not merely inert — it re-asks questions the user has
already answered, into a store nothing reads.

This is the third instance of the failure mode. #1027/#1062 fixed it for
employment, where the comment at `ranking-flags.service.ts:78` records that
"the old set shared only `business_owner` with the UI vocabulary, so **100% of
employed users had `isWorker: false`**".

## Decisions taken

1. **Consolidate toward Your Model.** It is the tiered, documented,
   relevance-connected model (50 fields, 13 categories, epic #740). Settings
   links to `/me/profile` instead of duplicating it.
2. **Your Model wins on conflict.** It is what already drives behavior. Settings
   values backfill only where the target is null.
3. **`educationLevel` is retired**, not merged. Attainment (`BACHELOR`) and
   enrolment (`k12`) are different questions; merging would be a regression, and
   attainment has no consumer. Approved 2026-08-26.
4. **The `policyPriorities` loss is accepted.** 11 of 20 values have no
   `interestTags` target and are dropped rather than coerced. Approved
   2026-08-26. The dropped set is enumerated below and must appear in the change
   record — not buried.
5. **`politicalAffiliation` and `votingFrequency` are retired outright.** No
   counterpart with a consumer; `politicalSelfId` has no consumer either, so
   merging into it would only move dead weight.

## Mapping tables

Lossless mappings only. Anything without an exact target is dropped.

### `homeowner_status` → `housing_tenure`

| from | to |
|---|---|
| `RENT` | `renter` |
| `OWN` | `owner` |
| `LIVING_WITH_FAMILY` | *(dropped — neither renter nor owner; `isRenter=false, isHomeowner=false` is correct)* |
| `OTHER` | *(dropped)* |
| `PREFER_NOT_TO_SAY` | *(dropped)* |

### `income_range` → `incomeBand` (T3, encrypted)

Exact, all 7 bands: `UNDER_25K`→`under_25k`, `RANGE_25K_50K`→`25k_50k`,
`RANGE_50K_75K`→`50k_75k`, `RANGE_75K_100K`→`75k_100k`,
`RANGE_100K_150K`→`100k_150k`, `RANGE_150K_200K`→`150k_200k`,
`OVER_200K`→`over_200k`. `PREFER_NOT_TO_SAY` dropped.

### `policy_priorities` → `interest_tags`

Carried (7): `healthcare`, `education`, `environment`, `immigration`, `taxes`,
`housing`, and `criminal_justice` → `justice`.

**Dropped (13 of 20)** — no `interestTags` equivalent, loss accepted per
decision 4: `economy`, `gun_rights`, `gun_control`, `social_security`,
`infrastructure`, `national_security`, `civil_rights`, `womens_rights`,
`lgbtq_rights`, `veterans_affairs`, `labor_unions`, `small_business`,
`agriculture`.

So **nearly two thirds of the policy-priority vocabulary has no target.** Some
of the losses are politically salient (`gun_rights`/`gun_control`,
`womens_rights`, `lgbtq_rights`, `civil_rights`), which is worth stating plainly
to users rather than dropping quietly.

Note also that five `interestTags` values have no policy-priority source at all
(`jobs`, `transit`, `public_safety`, `voting_rights`, `family`) — they are only
settable in Your Model, which is expected and needs no action.

### Retired with no mapping

`political_affiliation`, `voting_frequency`, `education_level`, `occupation`,
`household_size`.

## Subtasks

### 1. Backfill migration — additive only, no drops

**Files:** `supabase/migrations/<ts>_backfill_signal_from_user_profile.sql`
(generate via `/op-migration`)

Copy Settings answers into `signal_profiles` **only where the target is null**,
per decision 2. Applies the `housing_tenure` and `interest_tags` mappings above.

**Tests:** real-DB integration per mapping — the null-target-only rule, the
Your-Model-wins conflict case, and the no-target-drop.

### 2. Income backfill script — separate from the SQL migration

**Files:** `apps/backend/scripts/backfill-income-band.ts` (new)

`incomeBand` lives inside the AES-256-GCM `encryptedPayload` on
`sensitive_profiles`, so it **cannot be backfilled in SQL**. One-off Node script
using the existing `EncryptionService` and the Vault key.

Hard requirements: dry-run mode first; **no plaintext intermediate** (no temp
table, no CSV, no logging of values); skip users with `noFieldsMode` on — they
have explicitly asked for nothing to be written there; row counts and user ids
only in output.

**Tests:** integration against a seeded encrypted row; a no-fields-mode user is
skipped; an existing `incomeBand` is not overwritten.

### 3. Rework profile completion — highest-risk step

**Files:** `apps/backend/src/apps/users/src/domains/profile/profile.service.ts`

`hasCivic` / `hasDemographic` (lines 110–119) are the only readers of the eight
fields. They must read the SignalProfile equivalents before anything is removed,
or the meter drops for every existing user.

This changes a number every user can see. It lands before any field removal.

**Tests:** unit — a user with signal data and no legacy fields still reports
complete; a user with neither does not.

### 4. Remove the Settings UI

**Files:** `apps/frontend/app/settings/page.tsx`,
`apps/frontend/components/profile/CivicFieldsSection.tsx` (delete),
`apps/frontend/components/profile/DemographicFieldsSection.tsx` (delete),
`apps/frontend/locales/{en,es}/settings.json`

Both sections are replaced by a short link to `/me/profile`, so the questions
stay reachable from Settings without being asked twice. Spanish in the same PR.

**Tests:** page test that neither section renders and the link is present; a11y
pass on the reduced form.

### 5. Shrink the GraphQL surface

**Files:** `apps/backend/src/apps/users/src/domains/profile/dto/update-profile.dto.ts`,
`.../models/user-profile.model.ts`, `apps/frontend/lib/graphql/profile.ts`

Remove the eight fields from `UserProfile` and `UpdateProfileInput`.

**Federation-affecting** — validate gateway composition per CLAUDE.md. Removing
fields is breaking for any client still sending them; the frontend is the only
client, and step 4 ships first.

### 6. Column removal — SEPARATE PR, after deploy

**Files:** `supabase/migrations/<ts>_drop_legacy_profile_columns.sql`

Additive-only rule: never drop in the same migration as the change that stops
using the column. Columns are deprecated by steps 1–5 and removed only once
step 5 has shipped and been observed in production.

`income_range` matters most here — it must not linger as plaintext once the
encrypted copy is authoritative.

## Data classification detail

Three rules for the work:

1. **Never log field values** in the backfill — row counts and user ids only.
2. **The income backfill decrypts and re-encrypts real personal data.** It runs
   once, needs the Vault key, must not write plaintext anywhere, and must skip
   no-fields-mode users. Verify on a restored snapshot before prod.
3. Removing the plaintext duplicates is a **data-minimisation improvement** and
   should be stated positively in the change record.

No regulated data reaches logs, prompts, fixtures or any third party as a result
of this change. No new model calls.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Completion % visibly drops for every user | **high × likely** | Step 3 lands before any field removal; unit test pins a signal-only user as complete |
| Backfill overwrites a good Your Model answer | high × possible | Null-target-only; Your Model always wins; integration test on the conflict case |
| Income backfill leaks plaintext or corrupts the payload | **critical × possible** | Reuse `EncryptionService`, never hand-rolled crypto; dry-run mode; no plaintext intermediate; verified on a restored snapshot before prod |
| `policyPriorities` loss is silent | **high × likely** | 13 of 20 values enumerated above and in the change record; loss explicitly accepted, not coerced. Severity raised from medium once the true count was checked — this is most of the vocabulary, including politically salient values |
| Federation composition breaks on field removal | medium × possible | Gateway validation in CI; step 4 (client) ships before step 5 (schema) |
| Column drop outruns the deploy | high × possible | Two-phase by construction — step 6 is a separate PR after step 5 is observed in prod |
| Users answered both sides and disagree | medium × likely | Documented precedence: Your Model wins (decision 2) |
| No-fields-mode user gets data written to their T3 payload | **high × possible** | Explicit skip in the backfill script, with a test |

## Out of scope

- The 13-category Your Model taxonomy itself (epic #740).
- Giving `politicalSelfId` a consumer — it has none today, and adding one is a
  relevance-design question, not consolidation.
- Extending `interestTags` to cover the 11 orphaned policy priorities (loss
  accepted per decision 4; worth its own issue if the coverage is wanted).
