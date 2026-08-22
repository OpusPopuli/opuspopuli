# Plan: "What this means to you" — personalized petition impact

| | |
|---|---|
| **Issue** | [#1052](https://github.com/OpusPopuli/opuspopuli/issues/1052) |
| **Date** | 2026-08-21 |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** The user's signal profile (interests, life context, coarse location) is interpolated into an LLM prompt at runtime. Self-hosted inference, so it stays in the trust boundary — but minimum-necessary applies. Strict PHI/PII lens (no `.claude/compliance-profile.yaml`). |
| **Status** | Draft for approval. Not started. Epic — sibling to #740 / #752. |
| **Branch** | `feat/personalized-impact-1052` |

## One line

Lead the scan results with **"What this means to you"** — the measure's effects run
against *this citizen's* own model, not a generic summary.

## Why it's buildable now (the engine exists)

| The feature needs | We already have it |
|---|---|
| A "model of me" | Signal profile — interest tags, life context, coarse location, ranking flags (onboarding #754, model-of-me #752) |
| A personalization pipeline + taxonomy | Personalized-relevance epic #740, `docs/architecture/personalized-relevance.md` (T1/T2/T3 signals, ranking axes) |
| An LLM analyze pass on the scan | `documents` analyze pass calls the LLM via `@opuspopuli/prompt-client` |
| Versioned, auditable prompts | `prompt-service` (prompt text lives there — IP boundary) |
| A generic impact baseline to personalize | The analysis already computes *beneficiaries* / *who-may-be-affected* |

This is the **join** of the personal model and the measure analysis on a new surface — not new infrastructure.

## Design decisions

1. **Lead with it.** The personalized section renders **first** on the results page,
   above the match hero and summary. It is the payoff; everything else is support.
2. **A separate personalized call, not a bigger cached analysis.** The generic
   analysis stays globally cached by `(contentHash + promptVersion)`. Personalization
   is a **second** call keyed by `(contentHash + promptVersion + profileHash)` so it
   is per-user-correct and never leaks one citizen's read to another. Generic result
   is reusable across everyone; the personal layer rides on top.
3. **Fetch the profile via Federation, no new store.** `documents` resolves the
   authenticated user's signal profile through GraphQL Federation using `userId` from
   context. Bounded contexts intact.
4. **Fallback is the generic analysis.** No profile / empty profile / personalization
   failure → show today's analysis exactly. The feature only ever *adds*.
5. **Prompt text stays in `prompt-service`.** Add a personalized-impact prompt type;
   never inline it here.

## Reconnaissance corrections (2026-08-22)

The integration map corrected two assumptions above — these govern the build:

- **Profile access = frontend-passes-input, not federation.** The live
  personalization pattern (knowledge personalized-feed,
  `PersonalizationInputDto`) has the frontend pre-fetch `mySignalProfile`
  (interestTags) + `myRankingFlags` (derived booleans) and pass them as a
  mutation input. `OnboardingProvider` already fetches both. The
  subgraph→subgraph call ("Slice 2") does not exist yet — do **not** build it
  here. Mirror `PersonalizationInputDto`.
- **PII shape is booleans, not raw T3.** Only pass: declared `interestTags`,
  the `RankingFlags` **booleans** (`isRenter`, `isVeteran`, `isParent`, …), and
  a **coarse region label derived by the caller** from `UserAddress.postalCode`
  / `county` (e.g. `"94xxx"`). Raw sensitive values (veteranStatus, health,
  income, justice) never leave the users service — this is already enforced by
  the RankingFlags derivation. "Life context" in decision #1 therefore means
  the boolean flags + declared T2 signals, not raw fields.
- **Personalized cache needs its own store.** The generic analysis lives in a
  global `documents.analysis` Json keyed by `(contentHash + type)` — shared
  across all users. The per-user read cannot live there; add a small
  personalized-impact cache keyed by `(contentHash + promptVersion +
  profileHash)`.

## Subtasks

### 1. Personalized-impact prompt (private `prompt-service`)
Add `getPersonalizedImpactPrompt({ measureAnalysis, signalProfile })` returning prompt
text that maps the measure's effects to the person's situation, in plain language,
with an explicit "why this applies to you." Version + hash like the others.
**Tests:** prompt-service unit + A/B registration.

### 2. Signal-profile access in `documents`
**Files:** `apps/backend/src/apps/documents/src/domains/services/analysis.service.ts` (+ resolver/context).
Resolve the authenticated user's signal profile via Federation (reuse the HMAC data-source seam). Minimum-necessary projection — pull only the fields the prompt needs. **Federation:** new cross-subgraph read — validate composition at the API Gateway per CLAUDE.md.

### 3. Personalized-impact generation + cache
**Files:** analysis service.
After the generic analysis, make the personalized call (subtask 1) and persist/cache by `(contentHash + promptVersion + profileHash)`. Reuse the existing masked audit-log path; **tokens/PII masked**. Skip cleanly when no profile.
**Tests:** integration (real local DB) — cache hit per profile, distinct profiles get distinct reads, absent profile → null.

### 4. Frontend — lead the results
**Files:** `apps/frontend/components/petition/AnalysisDisplay.tsx`, `app/petition/results/page.tsx`, `graphql/documents.ts`, en/es locales.
New `PersonalizedImpact` block rendered **first**; graceful absence when null. WCAG 2.2 AA; on the petition pinned-dark surface use fixed tokens (see the Data-Sources contrast fix #1047 — do not repeat `bg-inverse-surface` + light text).
**Tests:** component + a11y.

### 5. Regulated-data pass + docs
Run `/op-data-scan`; document the profile→prompt data flow in `docs/guides/auth-security.md` or the personalized-relevance doc. No profile field in logs/fixtures/third parties.

## Data classification & handling

- **PII into a prompt** (interests, life context, coarse location). Self-hosted LLM → in trust boundary, but minimum-necessary: project only needed fields; never log the profile or the personalized text unmasked; audit entries mask per the existing convention.
- **Cache-key correctness is a privacy control**, not just perf: the `profileHash` component prevents serving one user's personalized read to another. Explicit test.
- **Coarse location only** — reuse the ~city-block rounding already applied to scans; never fine location into the prompt.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Personalized read served to the wrong user (cache collision) | **Critical × Rare** | `profileHash` in the cache key; integration test asserts distinct profiles → distinct reads. |
| PII over-exposed into prompt/logs | **High × Possible** | Minimum-necessary projection; masked audit path; `/op-data-scan` gate before merge. |
| Federation drift from the new cross-subgraph read | Medium × Possible | Gateway composition validation per CLAUDE.md; covered by CI. |
| LLM invents a personal impact not grounded in the measure | Medium × Possible | Prompt constrains to the measure analysis + profile; label as AI, keep the report-issue affordance; feeds The Seed corrections loop. |
| Personalization latency on top of analysis (shares Ollama) | Medium × Likely | Second call is small; cache per profile; fall back to generic on timeout. |
| No new GPL dependency | Low × Rare | None required. |

## Effort

**~3–4 focused sessions.** prompt-service (~0.5), documents federation + cache (~1.5), frontend lead section (~1), data pass + tests (~1).

## Explicitly out of scope

- Changing the generic analysis or its global cache.
- Fine-grained location or any new profile capture (reuse what onboarding already collects).
- Auto-personalizing other surfaces (briefings already do; this is the scanner).

## Decisions (resolved 2026-08-22)

1. **Profile fields into the prompt:** interest tags + life context (housing,
   household, veteran, occupation, …) + **coarse** (city-block-rounded)
   location. This is the declared minimum-necessary set for this feature.
2. **Anonymous scanners:** show the generic analysis plus a "Sign in to see
   what this means for you" nudge where the personalized section would sit.
   Personalization only runs for authenticated users with a profile.
3. **Caching:** cache the personalized read keyed by
   `(contentHash + promptVersion + profileHash)`. The `profileHash` is a
   privacy control, not just perf — one citizen's read can never reach another.
