# #1212 — Claim anchoring: ask the model to quote, let code locate

|                         |                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Issue**               | [#1212](https://github.com/OpusPopuli/opuspopuli/issues/1212) — Claim citations: ask the model to quote, let code locate |
| **Parent**              | #1209 (M3 — deterministic verification). Precondition for #1208's claim backfill                  |
| **Roadmap**             | Surfaced by R3 / M4 (#1142). Not itself an R3 exit                                                |
| **Date**                | 2026-09-16                                                                                        |
| **Author**              | Rodney Gagnon                                                                                     |
| **Base branch**         | `main`                                                                                            |
| **Branch**              | `fix/claim-anchoring-quote-then-locate-1212`                                                      |
| **Data classification** | Public civic records — **but see §4**: verbatim quotes can copy proponent contact details out of `full_text` (#1263) |
| **Compliance profile**  | `us-state-privacy` + `soc2` active; applicable class `ca-personal-information` (CCPA/CPRA)         |
| **Schema migrations**   | **None** — `analysisClaims` is JSONB (`schema.prisma:1215`)                                       |
| **GraphQL / federation**| **Yes** — additive fields on `PropositionAnalysisClaimModel`; validate at the API Gateway          |
| **Cross-repo**          | **Yes** — prompt text ships in `prompt-service` (public repo, `prisma/seed.ts`)                    |
| **Effort**              | ~5 focused sessions                                                                               |
| **Related**             | #1142 (eval harness, PR #1269), #1208 (claim backfill), #1209 (M3), #1263 (`full_text` PII), #955 (overclaim failure mode) |

---

## 1. The problem, in one line

`analysis_claims` asks the LLM to emit `sourceStart` / `sourceEnd` character offsets into
`fullText`. That is arithmetic over tokens, which the architecture cannot perform. It is not a
model-selection problem, and no model tested solves it.

The failure mode is fabricated positions rather than near-misses: qwen emits neat sequential
partitions (`260..580`, `580..850`, `850..1300` — it is *partitioning the document*, not locating
text), and granite cited `1240..5400` in a 2,799-character document.

**Why it reaches production looking fine.** `normalizePayload`
(`proposition-analysis.service.ts:440-471`) only *clamps* offsets into `[0, fullText.length]` and
drops inverted ranges. Granite's `1240..5400` silently becomes `1240..2799` — a 1,559-character
"citation" spanning more than half the measure — and renders in `ClaimAttribution.tsx` as precise
source attribution. Nothing compares `fullText.slice(sourceStart, sourceEnd)` to the claim text.

## 2. Baseline — this supersedes the numbers in the issue body

The issue body cites 12% → 20% (olmo instruct → think). Those came from the **2026-09-10 throwaway
script that was never committed** and cannot be re-derived — the unreproducible source that #1142's
S1 existed to replace.

Measured 2026-09-16 through the committed harness, matched quant (Q4_K_M), recorded digests,
identical fixtures, prompt `document-analysis-proposition-analysis` v1 hash `850bdd19629b`:

| Model                        | Anchoring (offsets) | Cites operative law | Cites transmittal | Median s/measure |
| ---------------------------- | ------------------- | ------------------- | ----------------- | ---------------- |
| `olmo-3:7b-instruct`         | **1/42 (2%)**       | 24%                 | 38%               | 26s              |
| `olmo-3:7b-think` +think     | **1/13 (8%)**       | 15%                 | 54%               | 609s             |
| `qwen3.5:9b` no-think        | **5/56 (9%)**       | 44%                 | 27%               | 71s              |

Result files (with provenance) in `packages/eval-harness/results/`:
`generation-olmo-3-7b-instruct-Q4-K-M-offsets.json`,
`generation-olmo-3-7b-think-Q4-K-M-think-offsets.json`,
`generation-qwen3-5-9b-Q4-K-M-offsets.json`.

The issue's *direction* reproduces — reasoning multiplies anchoring, here 2% → 8% at **23×** the
wall clock — and its conclusion holds: still a broken feature, now an expensive one. The absolute
numbers do not reproduce, and the lower ones make the case stronger, not weaker.

**Context that makes this the unblocking item:** `qwen3.5:9b` is ruled out on provenance grounds.
On every other axis `olmo-3:7b-instruct` matches or beats it — 10/10 valid JSON, zero fabricated
figures, **100% essential-provision recall against qwen's 94%**, at a third of the wall clock.
Anchoring is the *only* axis where it is materially worse. Fixing the contract is what allows qwen
to be dropped; shopping for a different model under this contract does not.

## 3. What is already built — do not rebuild it

- **The scorer.** `packages/eval-harness/src/scoring/anchoring.ts` already takes
  `AnchorContract = "offsets" | "quote-then-locate"` as a parameter. `scoreQuoteClaim` performs
  whitespace-normalised `indexOf` (a model reflowing a line break is not a wrong citation) and then
  a `supportRatio` check — so a quote that is *found* but does not support its claim still scores
  `unsupported`. The contract cannot inflate the number by making quoting easy. Verdicts:
  `anchored` / `quote-not-found` / `missing-anchor` / `unsupported` / `out-of-range` / `empty-span`.
- **The precedent, ten lines away in the target file.** `normalizeSections`
  (`proposition-analysis.service.ts:508-557`) already does quote-then-locate for section headings —
  `fullText.indexOf(heading, searchFrom)`, snap to the real match — carrying the comment *"LLMs
  cannot count characters precisely."* `LegislativeAction` spans are likewise regex-derived and
  re-sliced at read time. Claims were simply never given the same treatment.
- **Staleness detection.** `analysisPromptHash` / `analysisPromptVersion` columns already exist and
  are the mechanism for driving regeneration.
- **Zone identification.** `scoring/source-hierarchy.ts` already partitions a measure into
  transmittal / findings / operative zones — needed by the redaction mitigation in §4.

## 4. Data classification — the non-obvious hazard

Public civic records; no new personal-data flow *by intent*. One measured hazard must be designed
against rather than assumed away:

> **27–54% of citations across all three models point at the AG transmittal letter** (table in §2)
> — which is precisely where `propositions.full_text` carries proponent postal addresses, emails
> and phone numbers, **unredacted in production** (#1263).

Under the offsets contract those are fabricated positions that rarely resolve to real text. Under
quote-then-locate the model emits a **verbatim copy** of the span it cites. A quoted transmittal
block therefore writes a proponent's contact details into `analysis_claims` and publishes them
through a new GraphQL field onto the public proposition page. The contract change converts a
fabrication defect into a disclosure path.

**Mitigation (belongs in S3, not a follow-up):** run `redaction.ts`'s patterns over any candidate
quote and reject or redact on a hit; prefer refusing quotes that resolve inside the transmittal
zone, which `source-hierarchy.ts` can already identify. A claim about what the measure *does*
should not be citing the covering letter regardless.

## 5. Subtasks

Critical path: **S0 → S1 → S2 (gate) → S3 → S4**. S5 must be settled before #1208 consumes the rows.

### S0 — Harness prerequisites · 0.5 session

> **Blocking dependency.** PR #1269 (the #1142 harness) merged on 2026-09-16 as `f771f1ee`, so the
> generation leg, the anchoring scorer and both contracts ARE on `main`. The two fixes below are
> **not**: they were committed to the #1142 branch minutes after that PR merged, so they missed it
> and now sit on **PR #1271**. Verified against `origin/main` at the time of writing —
> `setGlobalHttpPool` appears 0 times in `backends/llm.ts`, and `omission-eval.ts` still writes a
> fixed `results/omission.json`.
>
> **This branch is cut from `main` and therefore does not have them.** Either wait for #1271 to
> merge and rebase, or branch from `fix/eval-harness-measurement-defects-1142`. Starting S2 without
> the headers-timeout fix means any generation over five minutes dies as `TypeError: fetch failed`,
> which reads as a model failure rather than a transport one.


Three items, all in `packages/eval-harness`, without which the measurement cannot run or cannot be
trusted:

- **undici headers timeout.** `ILLMProvider.generate()` posts `stream: false`, so Ollama sends no
  headers until generation completes. undici's default `headersTimeout` is 300s and is **not**
  governed by `requestTimeoutMs` — any generation over five minutes dies as
  `TypeError: fetch failed` / `UND_ERR_HEADERS_TIMEOUT`. Measured: `qwen3.5:9b --think` died at
  exactly 302s; two *non-think* qwen measures took 1086s and 1150s under memory pressure and would
  have died too. Fix is `setGlobalHttpPool({ headersTimeoutMs: 1_350_000 })` in `backends/llm.ts`,
  mirroring `region-worker/src/main.ts`. **Done — PR #1271, not yet merged.**
- **`--document-type` flag on `generation-eval.ts`.** `resolveAnalysisPrompt` is called with a
  hardcoded `"proposition-analysis"` (line 403). Without a selector, `--contract quote-then-locate`
  scores output produced by the *offsets* template and reports `missing-anchor` for every claim —
  a silent wrong measurement.
- **`omission-eval` output naming.** It writes a fixed `results/omission.json` regardless of which
  run it scored, so scoring a second model silently overwrites the first. Use `slugFor()` as the
  other legs do. **Done — PR #1271, not yet merged.**

### S1 — `prompt-service`: the quoted template · 1 session

- **Repo:** `prompt-service` (separate, public). **File:** `prisma/seed.ts`, template
  `document-analysis-proposition-analysis` at ~line 726.
- Output contract becomes `{ claim, field, sourceQuote, confidence }` — the model emits **no**
  offsets.
- Ship as a **separate template name** first so both contracts can be measured side by side without
  touching production; promote to a new version of the canonical name once S2 proves it. (See §7,
  open decision 1.)
- Never inline the prompt text in this repo. Keep version + content-hash attestation — the
  harness's `resolveAnalysisPrompt` verifies the returned hash against prompt-service and refuses a
  mismatch.
- **Tests:** prompt-service seed/validation tests.

### S2 — Measure before committing service work · 0.5 session · **DECISION GATE**

```
pnpm --filter @opuspopuli/eval-harness eval:generation -- \
  --model olmo-3:7b-instruct --no-think \
  --contract quote-then-locate --document-type <quoted-template>
```

Compare against the 2% baseline in §2. Acceptance target per the issue is **a step change, not an
increment**.

**If `quote-not-found` dominates**, stop. That is the live risk for a 7B model that paraphrases,
and pushing on would trade a citation problem for a recall problem. Fall back to **cite-by-segment-id**:
code pre-segments `fullText` into numbered spans and shows markers inline; the model emits a
`segmentId`. That is *selection* rather than copying or counting — the easiest of the three tasks
for a small model and immune to paraphrase — at the cost of a larger prompt and coarser granularity.

A third option exists as a fallback locator rather than a contract: **locate-by-retrieval**, embedding
the claim and finding its best-supporting span, gated on a threshold derived from the null
distribution. The machinery already exists in `scoring/omission.ts` (threshold = p95 of non-match
similarities, with a floor so an uncalibratable set cannot silently pass everything). It asks the
model for nothing. **It must remain a locator, never a verifier** — retrieval will confidently
locate a plausible span for a claim the source does not support.

### S3 — `region`: locate and derive · 1 session

- **Modify:** `apps/backend/src/apps/region/src/domains/proposition-analysis.service.ts:440-471`.
  Replace `sourceStart: clamp(c.sourceStart)` with a locator that derives offsets from
  `sourceQuote`: whitespace-normalised `indexOf`, plus a short fuzzy pass for OCR-style drift.
  Mirror `normalizeSections` directly above it.
- Unlocatable quote → `unverified`. **Fail closed**, matching the petition-verification precedent
  where an unmatched scan degrades rather than guesses.
- Apply the §4 redaction check here.
- **No migration** — `analysisClaims` is JSONB, so per-claim fields are additive at the data layer.
- **Tests:** unit specs for locatable and unlocatable quotes; a quote containing contact details is
  rejected; plus the repo's reintroduce-the-bug regression test.

### S4 — Gate and render · 1 session

- **Modify:** `apps/backend/src/apps/region/src/domains/models/proposition-analysis.model.ts` —
  additive `sourceQuote` and/or `verified` on `PropositionAnalysisClaimModel`. **Validate federation
  at the API Gateway** (`apps/backend/src/api`) per CLAUDE.md.
- **Modify:** `apps/frontend/components/region/ClaimAttribution.tsx`, which currently keys off
  `sourceStart`/`sourceEnd` and renders *"See source passage (chars X–Y)"*. Unverified claims need a
  presentation that is not a citation. All strings via `react-i18next`; run `pnpm test:a11y`
  (WCAG 2.2 AA) before marking done.

### S5 — Existing rows · 0.5 session

Stored offsets from the old contract are not trustworthy, and old rows carry **no quote**, so
re-verification with the new locator is impossible. They must be **regenerated**, driven by
`analysisPromptHash` staleness. Cost is small: 69 propositions × ~26s on `olmo-3:7b-instruct` ≈ 30
minutes. **Settle this before #1208's backfill consumes the rows.**

### S6 — Follow-ups · separate issues, not this branch

`minutes.summary_claims` uses free-text `citation: { pageHint?, quote? }` never checked against
`rawText`; `representatives.bio_claims` carries `sourceHint` documented as *"advisory, not a verified
citation"*. Same unverified-citation class; adopt the same contract once it is proven on
propositions.

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
| ---- | --------------------- | ---------- |
| Paraphrase makes quotes unlocatable on 7B models | high × likely | S2 decision gate **before** service work; segment-id fallback pre-designed |
| Verbatim quotes copy proponent contact details into a new field and onto the public page (#1263) | **high × likely** | Redaction check in the S3 locator; refuse quotes resolving inside the transmittal zone |
| Service ships before template → runs against the old contract | high × possible | Template first; gate on hash; `requirePromptServiceUrl` throws at boot in production |
| Fail-closed leaves near-zero rendered citations at current anchoring rates | high × likely | Product decision in S4 — label vs drop. "Honest but empty" is a real possible outcome and is still better than fabricated attribution |
| Regeneration cost for existing analyses | medium × likely | ~30 min for 69 propositions on OLMo-instruct |
| Federation drift from additive fields | medium × possible | Gateway validation per CLAUDE.md |
| Measuring the wrong template and believing it | medium × possible | S0's `--document-type` flag; `resolveAnalysisPrompt` hash check refuses a fallback |
| AGPL-3.0 dependency constraints | low × rare | No new dependencies |

## 7. Open decisions for whoever picks this up

1. **Separate template name vs new version of the canonical one.** Affects how production switches
   and whether both contracts can run side by side. Recommendation: separate name for S2, promote
   after.
2. **Drop unverified claims, or render them labelled.** At a 2% anchoring rate, dropping is close to
   rendering nothing. This is a product call, not an engineering one.
3. **Regenerate all analyses eagerly, or mark stale and regenerate lazily.**

## 8. Running the harness — environment notes

Gotchas that cost time on 2026-09-16, recorded so they do not cost it again:

- **Node 22+ required.** The default shell node here is v20.20.2 and `pnpm` crashes on
  `node:sqlite`. Use `~/.nvm/versions/node/v24.21.0/bin` (repo `.nvmrc` says 24). The pre-commit
  hook runs the full repo suite and needs this too — never reach for `--no-verify`.
- **prompt-service must be reachable.** `PROMPT_SERVICE_URL=http://localhost:3210` (the container
  `opuspopuli-prompts`; note `apps/backend/.env` has it commented out and pointing at 3200).
  `PROMPT_SERVICE_API_KEY` must be one of the container's `API_KEYS`. The harness refuses to run
  without them by design (#1246/#1249) rather than falling back to the local `prompt_templates`
  table, which does not carry this template.
- **Run models strictly sequentially.** The GPU saturates at one request. Concurrent runs corrupted
  a timing set: two measures reported 1.2–1.5 tok/s against ~22 tok/s with normal token counts.
  Quality scores were unaffected; timings were not.
- **Rebuild dependent packages after a rebase.** A stale `packages/scraping-pipeline/dist` failed 11
  backend suites with `has no exported member 'detectSummaryEcho'`. `assertFreshBuilds()` guards the
  harness's own guarded packages but not everything.
- **Long runs are safest detached.** Background tasks were stopped twice mid-flight; `nohup` (note:
  macOS has no `setsid`) survived.

## 9. Acceptance criteria — from the issue, unchanged

- [ ] Claims carry a model-supplied verbatim quote; offsets are computed by code, never accepted from the model
- [ ] A claim whose quote cannot be located is marked `unverified` and is **not** rendered as a cited claim
- [ ] Anchoring rate measured before/after on the #1142 fixture set — target is a step change from the current 2–9%, not an increment
- [ ] Regression test: a deliberately unlocatable quote is rejected; a valid quote resolves to correct offsets
- [ ] Existing rows re-verified or regenerated — decided before #1208's backfill consumes them
- [ ] Cross-repo release ordered so the service change never runs against the old template
