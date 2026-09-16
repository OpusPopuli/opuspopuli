# #1142 — LLM eval harness: generation, symmetry and the road to R3's exits

|                         |                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Issue**               | [#1142](https://github.com/OpusPopuli/opuspopuli/issues/1142) — LLM pressure test: candidate models on our real workloads (eval harness) |
| **Roadmap**             | R3 / M4 (`ai-architecture-roadmap.md`, R3 revision approved 2026-09-11)                            |
| **Date**                | 2026-09-14                                                                                        |
| **Author**              | Rodney Gagnon                                                                                     |
| **Branch**              | `feat/eval-harness-generation-and-symmetry-1142`                                                  |
| **Data classification** | Public civic records only — but `full_text` carries proponent contact details, redacted in fixtures. **Corrected during S1; see §4** |
| **Compliance profile**  | `us-state-privacy` + `soc2` active; applicable class `ca-personal-information` (CCPA/CPRA)         |
| **Schema migrations**   | **None**                                                                                          |
| **GraphQL / federation**| **None** — no SDL, resolver or subgraph change; no federation impact                               |
| **Effort**              | ~9 focused sessions ≈ 6–7 working days                                                            |
| **Related**             | #1140 (titler, open), #1143 (closed — published-prompts decision), #1209 (M3 verification), #1212 (quote-then-locate), #1219/#1220 (R2 corpus fidelity), #1229 (retrieval baseline, shipped), #1243/#1245 (OCR leg, shipped) |

---

## 1. Exit criteria

From roadmap R3, verbatim:

> harness runs end-to-end on **≥50 gold items**; **symmetry metrics produce numbers**.

Both are addressed on the critical path (S0 → S1 → S2 → S3 → S4). Everything after S4 is
completeness, and S8 is the designated cut if the exits come under time pressure.

### 1.1 Exit status — 2026-09-16: both met

| Exit | Status | Evidence |
| ---- | ------ | -------- |
| ≥50 gold items, end to end | **Met — 56** (35 EN + 21 ES) | `fixtures/retrieval-propositions.json`, re-baselined post-#1261 across 69 documents |
| Symmetry metrics produce numbers | **Met** | `src/symmetry-eval.ts`, `src/scoring/symmetry.ts`; 5 pairs / 10 measures, control pair clean (length ratio 0.95, provisions 5-v-5) |

All ten subtasks landed, S0 through S9. S8 — the designated cut — was run rather than dropped and
returned a **negative** result: the Tesseract/VLM divergence signal sits inside Tesseract's own
noise floor, so `scoring/divergence.ts` records the measurement but `omissionSignal()` refuses to
return a verdict until `MIN_CALIBRATION_SAMPLES` known-good pairs exist. A negative result recorded
is the outcome this harness exists to make possible.

Two things this work produced that belong to other issues, filed rather than patched here per §3:
**#1263** (proponent contact details in `propositions.full_text` reach the analysis prompt and the
public page unredacted in production) and the anchoring measurement — **8/121, under 7%** — that
argues for prioritising **#1212**.

## 2. Starting state — what exists and what does not

| Leg                                                        | State                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `eval:retrieval` / `eval:baseline`                          | Shipped (#1229). 22 items (14 EN + 8 ES), MiniLM-384 and nomic-768 baselines recorded      |
| `eval:ocr`                                                  | Shipped (#1243/#1245). 5 engines, prompt-attributed results                                |
| **Generation leg**                                          | **Absent from the repo**                                                                  |
| **Symmetry / omission / framing / calibration / hierarchy** | Not built                                                                                 |
| **Adversarial fixtures** (#1143)                            | Not built                                                                                 |
| **model + quant + runtime provenance**                      | Not recorded — `getModelName()` returns the bare Ollama tag                                |
| **Throughput baseline** (`OLLAMA_NUM_PARALLEL=4`)           | Not run                                                                                   |
| Gold items                                                  | 22 of ≥50                                                                                 |

**The load-bearing gap is the generation leg.** The headline table in #1142 — JSON validity,
anchoring and fabrication across six models, dated 2026-09-10 — came from a throwaway script that
was never committed. Those numbers **cannot be re-derived today**. A harness whose stated purpose is
that confident claims must survive measurement cannot have its own headline results be
unreproducible. S1 fixes that first.

## 3. Scope boundary

This work is **instrumentation only**. It does not:

- pick a model (R7 / M7, gated on this harness),
- change the extraction or analysis pipeline,
- fix claim anchoring (#1212 owns the quote-then-locate contract change),
- touch any service, migration, GraphQL schema or worker.

Findings that argue for pipeline changes get **filed as issues, not patched here** (risk R13).

### 3.1 Isolation guarantee

A parallel context is working R2 (#1219/#1220, region + extraction) and R4 (provenance, epic #1207).
This plan is confined to `packages/eval-harness/` so the two streams cannot collide.

Verified, not assumed: `ci.yml` runs `pnpm lint` and `pnpm test`, which are `pnpm -r lint` and
`pnpm -r test`. Adding a `test` script to the package's own `package.json` enrols the harness in CI
with **no workflow edit** — recursive scripts skip packages that lack the script, which is precisely
why the harness is invisible to CI today. `pnpm-workspace.yaml` already globs `packages/*`, and the
root `tsconfig.json` has no `references` array, so neither requires a change.

Complete out-of-package footprint:

| File                                  | Why                                                    | Conflict risk                                        |
| ------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `docs/plans/1142-llm-eval-harness.md` | This plan of record — `/op-trace` traceability anchor   | **None** — new file, unique name                      |
| `pnpm-lock.yaml`                      | Test-runner devDeps (see S9)                            | Narrow — one hunk under the `packages/eval-harness:` importer |

`ai-architecture-roadmap.md` is a **working document and is not committed**. A local untracked copy
lives at `docs/plans/ai-architecture-roadmap.local.md`; R3 annotations go there, to be merged back by
hand if and when that makes sense.

### 3.2 Semantic coupling with R2 / R4

No file overlap. Two couplings, both mitigated by design:

- **R2 changes proposition summaries** → the committed corpus fixture drifts. This is a property of
  the snapshot approach, not a defect: the harness measures a **pinned** corpus, so R2's churn cannot
  destabilise it mid-flight. Re-snapshotting is one documented `psql` command when a new baseline is
  wanted.

  > **CORRECTED 2026-09-14, during S3.** S0 reported the dev corpus at ~12.5% title echo and
  > inferred that #1219 had landed the R2 summary work. Both halves were wrong. Measured properly:
  > **53 of 65 summaries contain the title verbatim**, and ~85% carry nothing but scraper furniture
  > (`Title and Summary Issued on <date>`, `Fiscal Impact Estimate Report`, `Proponent`). #1219
  > fixed a sync rollback on a missing summary, not summary capture — that is **#1220, still open**.
  > The bad reading came from a heuristic testing whether the summary *starts with* the title; it
  > does not, because the boilerplate comes first. **R2's exit criterion (<10% title echoes) is not
  > met**, and the roadmap's ordering rule — R2 before R3 gold-item authoring — therefore bites on
  > S3.
- **R4 changes `LlmGeneratorBase` / provider interfaces** → the generation leg's imports could break.
  Mitigation: consume only the narrow stable surface (`ILLMProvider.generate()`,
  `PromptClientService` public methods) behind an adapter confined to `src/backends/`, so a provider
  change is a one-file fix. The harness **imports** production code and never edits it.

## 4. Data classification

Compliance profile (`.claude/compliance-profile.yaml`) declares **`us-state-privacy` + `soc2`**;
`hipaa`, `part11`, `gxp-csa` and `iso-medical` are deliberately **not** declared. The applicable
regulated class is therefore **`ca-personal-information` (CCPA/CPRA)**.

> **CORRECTED 2026-09-14, during S1.** The paragraph below originally read "No user account,
> profile, address or petition-signature data enters any prompt, fixture, log or result file."
> That was wrong about `propositions.full_text`, and the correction is recorded rather than
> silently edited.

**Every fixture is a public civic record** — AG-filed initiative text, Sonoma County measures,
California legislative bills. No user account, profile or petition-signature data enters any
prompt, fixture, log or result file.

**But `full_text` is not only measure text.** For AG-filed California initiatives it includes the
proponent's transmittal letter, carrying a named individual's postal address, personal email
address and phone number. Nine of the ten measures selected for the generation fixture contain at
least one; two carry street addresses that read as residential. One candidate measure
(`25-0012A2`) turned out to have a cover letter as its *entire* `full_text` — enclosure list,
proponent block, purpose paragraph — and was dropped from the fixture for that reason as well.

These are public records: the Attorney General publishes proponent contact details, and CCPA
excludes information lawfully made available from government records from "personal information"
(Cal. Civ. Code § 1798.140(v)(2)). The exemption very probably applies. The fixture redacts them
anyway (`src/redaction.ts`, enforced as a post-condition on `fixtures:fulltext`), for three
reasons that do not depend on that exemption holding:

1. **Committing is hard to reverse.** A fixture lands in git history, and republishing a public
   record as test data in a source repo is a different act from the state publishing it — not one
   to perform by default on an assumed exemption.
2. **It is not measure content.** A proponent's phone number is filing furniture.
3. **It corrupts the scorers.** ZIP codes, suite numbers and phone numbers are digit strings, and
   the grounding scorer counts digit strings.

**Open finding, not fixed here: production sends `full_text` to the model unredacted, and renders
it to citizens.** Filed as **#1263**. The redaction changes the fixture, not the pipeline, and
#1142 must not be read as having addressed it. Scale on the dev corpus: of 53 measures with
`full_text`, 29 carry an email address, 32 a phone number and 17 a street address.

Three data paths audited and cleared:

| Path                 | Flow                                                                        | Finding                                                                                                   |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Prompts → model**  | Public civic text → local Ollama → JSON                                     | No third-party model service. The S4 LLM-judge inherits the same boundary                                   |
| **Scan fixtures**    | `scanned-proposition.jpeg` / `-cropped.jpeg`                                | Verified **blank** 25-0007A1 — every signature, name and address field empty. Scan images are never persisted by design (#1075, `location: 'not-stored'`) |
| **Result files**     | `packages/eval-harness/results/*.json`                                      | Gitignored; contains model output over public text only                                                     |

**Constraints this plan imposes on itself:**

- S6 adversarial fixtures are **synthetic injection text over public civic records**. No real personal
  data, no real signatures, no photographed signed petitions.
- No subtask requires a photographed signed petition, and none may add one.

**Flagged, deferred, and explicitly not authorised here:** recalibrating `MIN_VERIFIED_SIMILARITY`
requires **re-photographing petitions** — the #1074 golden set is not replayable because scan images
and their OCR text are never persisted. Those photographs **would** be CCPA personal information:
signatures, printed names, residential addresses. That work belongs to #1074/#1220 and needs its own
data-handling design before anyone picks up a camera.

`/op-data-scan` runs before PR prep regardless of the above.

## 5. Subtasks

Critical path to the R3 exits: **S0 → S1 → S2 → S3 → S4**. S5–S7 parallelise after S1. S8 is the cut.

### S0 — Corpus fixture verification & retrieval re-baseline · 0.5 session

The roadmap requires R2 before gold-item authoring ("One ordering that does matter: R2 before R3's
gold-item authoring"). #1219 has merged and the committed fixture already reads ~12.5% title-echo, so
this is a **verification** task, not a refresh — but verify rather than assume.

- **Modify:** `fixtures/corpus-propositions.json` — refresh via the documented `psql` command only if stale
- Re-run `eval:baseline` and the nomic leg; record the numbers in the README baseline table
- **Tests:** none (measurement task)

### S1 — Generation eval leg · 1.5 sessions · **load-bearing**

- **Create:** `src/generation-eval.ts`
- **Create:** `src/scoring/{json-validity,grounding,anchoring,abstention}.ts`
- **Create:** `src/backends/` — the R4 coupling adapter (§3.2)
- **Create:** `fixtures/fulltext-propositions.json` — a new snapshot. The existing corpus fixture is
  `title + "\n\n" + summary` only (exactly what `PropositionEmbeddingService.embeddingSource()`
  builds); claim-span anchoring needs `fullText`. Document the refresh command in the README,
  matching the corpus-fixture pattern
- **Create:** `fixtures/gold-proposition-analysis.json`
- Drives the **real** `@opuspopuli/llm-provider` and `@opuspopuli/prompt-client` against the
  production `document-analysis-proposition-analysis` template — not a reimplementation. This is the
  same discipline the ollama retrieval backend already follows, and for the same stated reason

Encodes the four harness requirements #1142 says not to skip:

1. `think` set explicitly per model (production sends `think: false`, `ollama.provider.ts:271`)
2. the real token budget — `PROPOSITION_ANALYSIS_MAX_TOKENS` defaults to **6000**, not 2000
3. the real published prompt from prompt-service, not the local stub fallback
4. **no field-completeness scoring** — it actively rewards fabrication (§6, R-trap)

Metrics: JSON-validity rate · numeric grounding (every `$`, percentage and magnitude emitted must
appear in the source text) · abstention correctness (an empty `fiscalImpact` on AG-filed text is the
**right** answer) · claim-span anchoring.

Two design requirements on the anchoring scorer:

- **It takes the contract as a parameter** and supports both today's model-emitted offsets and
  #1212's quote-then-locate, so #1212 lands with a before/after number instead of being
  re-instrumented afterwards.
- **It scores raw offsets, never `normalizePayload`-clamped ones.** Clamping turns granite's
  `1240..5400` in a 2,799-char document into a plausible-looking 1,559-char span — it hides exactly
  the failure being measured, and renders to citizens as precise attribution.

- **Tests:** co-located `*.spec.ts` per scorer — grounding extraction, span verification, abstention
  classification. Pure functions, so unit-testable without a model

### S2 — Run provenance: model + quant + runtime · 0.5 session

- **Create:** `src/provenance.ts` — probe Ollama `/api/show` for `quantization_level`, digest and
  family; record the runtime (`ollama` vs an MLX / vLLM-Metal eval-only sidecar)
- **Modify:** `src/retrieval-eval.ts`, `src/ocr-eval.ts`, `src/generation-eval.ts` — result shapes
  (additive fields only) and result-filename slugs

R3 mandates matched-quant comparison. Ollama serves q4 by default, so an OLMo-q4 vs qwen-q4 result is
partly a quantization comparison; without this, #1149's caches blend incomparable outputs.
`getModelName()` returns only `this.config.model` — the bare tag.

- **Tests:** unit test for the `/api/show` parser against a captured fixture response

### S3 — Grow gold items to ≥50 · 1.5 sessions · **exit criterion 1**

- **Modify:** `fixtures/retrieval-propositions.json` — 22 → ≥50, holding the EN/ES ratio near 60/40
- Author against post-#1219 summaries and `fullText` spans, per the roadmap's corpus-quality caveat
- **Keep the existing 22 unchanged** so the recorded #1229 baselines stay comparable; report old-22
  and full-set metrics separately
- Prefer oblique phrasings over title keywords — a query that restates the title measures string
  overlap, not retrieval
- **Tests:** fixture-shape validation — unique ids, every gold id resolves against the corpus,
  difficulty within enum

### S4 — Symmetry metrics · 1.5 sessions · **exit criterion 2**

- **Create:** `src/symmetry-eval.ts`, `src/scoring/symmetry.ts`
- **Create:** `fixtures/symmetry-pairs.json`

#1140's titler is open and unbuilt, so the first symmetry case runs against the
**proposition-analysis generator** instead. The corpus already supplies genuine opposed pairs:

| Pair                                                              | Axis                                    |
| ----------------------------------------------------------------- | --------------------------------------- |
| `25-0016` vs `25-0004A1` / `25-0005A1` / `25-0006A1` / `25-0037A1` | extend taxes to fund services ↔ limit voters' ability to raise revenue |
| `25-0024A1` vs `25-0041A1`                                        | one-time wealth tax ↔ prohibit new personal property taxes |
| `25-0031` vs `25-0015`                                            | redistricting, from opposing directions |
| `25-0025A1` vs `25-0036A1`                                        | near-duplicate AI child-safety filings (duplicate-handling control) |

The fixture is structured so a #1140 titler case drops in unchanged when that lands.

Two-track measurement, deliberately:

1. **Deterministic** — hedging-marker density, valence lexicon, summary length, field-presence
   parity, provision-count parity across the pair
2. **LLM-judge blind A/B** — side-swap and position randomisation, judge model pinned and disclosed
   in every result, reported **alongside** the deterministic track and **never** as the sole gate

- **Tests:** scorer unit specs, plus a swap-invariance test asserting the judge harness produces
  mirrored results on mirrored input

### S5 — Omission, framing, calibration, source hierarchy · 1 session

- **Create:** `src/scoring/{omission,framing,calibration,source-hierarchy}.ts`, wired into
  `generation-eval`
- **Calibration:** self-reported confidence vs measured correctness. The Legistar structural-manifest
  case is the motivating fixture — wrong, plausible and self-assured at confidence 0.9
- **Omission:** gold-provision recall against hand-listed provisions on a ~10-measure subset
- **Tests:** co-located scorer specs

### S6 — Adversarial fixtures (#1143) · 0.75 session

- **Create:** `fixtures/adversarial-propositions.json`
- Prompt-injection text embedded in measure `fullText`. Per the #1143 decision, published prompts
  recruit red-teamers and the **verification gates carry the defence** — so measure instruction-follow
  rate and whether injected content reaches the payload
- Fixtures are synthetic text over public civic records (§4)
- **Tests:** injection-detection scorer spec

### S7 — Throughput baseline · 0.5 session

- **Create:** `src/throughput-eval.ts`
- `OLLAMA_NUM_PARALLEL` is set nowhere and every app-side concurrency knob is 1. Set it to 4, match
  one worker, re-time a representative job; record tok/s and s/measure per model + quant + runtime
- Sizes M6's "adversarial review doubles inference" constraint with data instead of a guess, and
  informs the bills sync that already takes ~48h at `BILL_ENRICHMENT_CONCURRENCY=1`
- **Tests:** none (measurement task)

### S8 — Tesseract / VLM divergence metric (E-24) · 0.75 session · **deferrable**

- **Modify:** `src/ocr-eval.ts` — divergence score between the Tesseract and VLM transcriptions of
  the same image, as the calibration input for the censorship/omission guard
- **Cut this first** if the ≥50-item and symmetry exits come under pressure. It is the one subtask
  outside R3's stated exit criteria
- **Tests:** divergence-scorer spec

### S9 — Docs, package wiring, plan of record · 0.5 session

- **Modify:** `README.md` — new legs, new baselines, honest-limits update, and the prompt-service
  prerequisite: the `Prompt template "ocr-transcription" not found in database` throw is
  **deliberate** (#1246/#1249), not a failure. Add a preflight check naming `PROMPT_SERVICE_URL`
- **Modify:** `package.json` — `eval:generation`, `eval:symmetry`, `eval:throughput`, and a `test`
  script. The package has **no** `test` script today, so `pnpm -r test` skips it entirely and the new
  scorers would ship untested
- **Local only:** `docs/plans/ai-architecture-roadmap.local.md` — mark R3 exits as met
- Model-driven legs stay manual: they need local weights and are not CI work

**Test-runner decision.** Recommendation: **jest + ts-jest**, matching all 15 sibling packages and
accepting `--coverage` natively — which matters because `pnpm test:ci` is `pnpm -r test -- --coverage`,
and a script that chokes on that flag breaks `test:ci` repo-wide (R14). Cost is one narrow
`pnpm-lock.yaml` hunk plus ESM friction, since eval-harness is `"type": "module"` where the siblings
are CJS.

The alternative, `tsx --test` over `node:test`, needs **zero new dependencies** and therefore zero
lockfile change, but diverges from convention and needs a wrapper to tolerate `--coverage`. This could
not be settled empirically at plan time: `packages/eval-harness` has never been installed in this
clone, and the default local Node is v20.20.2 while pnpm 11 requires Node 22 (it crashes on
`node:sqlite`; v22.23.2 is available via nvm). **Confirm at the top of S1 and fall back to jest.**

## 6. Risk register

Format: `severity × likelihood → mitigation`.

| #   | Risk                                                                                                          | Severity × Likelihood | Mitigation                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Single-run variance makes rankings noise — qwen anchored 3/16 in one pass and 0/30 in the next, identical settings | **high × likely**     | Minimum N=3 runs per candidate; report median + spread, never a single figure; pin temperature; seed where the runtime supports it; README states single-run numbers are directional only |
| R2  | The symmetry LLM-judge is itself an LLM — circular, and a biased judge manufactures a clean bill of health      | **high × possible**   | Deterministic lexical track reported first and alongside; side-swap + position randomisation; judge model pinned and disclosed per result; never the sole gate |
| R3  | Anchoring metric hard-coded to today's offset contract, obsoleted the moment #1212 lands                        | **medium × likely**   | Scorer takes the contract as a parameter; both contracts supported from day one; score raw offsets, never `normalizePayload`-clamped ones                   |
| R4  | Gold-item authoring bias — the same session writes the queries **and** the labels                               | **medium × likely**   | Schema-first growth; author against `fullText` spans; existing 22 frozen so baselines stay comparable; matched-item comparison is the only sound use, and the README says so |
| R5  | Corpus ceiling — items authored against title-echo summaries inherit the defect                                 | **medium × possible** | S0 verifies the post-#1219 refresh before any authoring (roadmap: R2 precedes R3 authoring)                                                                 |
| R6  | `think` / token-budget misconfiguration silently invalidates a whole run — the first run produced *entirely invalid* results this way | **high × possible**   | Explicit per-model `think`; assert non-empty response and `done_reason !== 'length'`; fail loudly with the config echoed rather than scoring an empty string as 0/3 |
| R7  | Un-matched quantization makes a model comparison partly a quantization comparison                               | **medium × likely**   | S2 lands before any candidate sweep; results refuse to compare across differing quant/runtime                                                               |
| R8  | prompt-service unreachable → the harness throws by design (#1246/#1249) and reads as a bug                       | **low × likely**      | Preflight check with an actionable message naming `PROMPT_SERVICE_URL`; documented in the README as a prerequisite, not a failure                            |
| R9  | **Regulated-data exposure** — a fixture carries CCPA personal information. **OCCURRED in S1**: proponent postal addresses, personal emails and phone numbers are present in `propositions.full_text` (9 of 10 candidate measures) | **high × likely** *(was rare)* | `src/redaction.ts` strips them, enforced as a build post-condition that fails rather than writes; the cover-letter measure was dropped entirely; blank-form scan only; re-photography deferred to #1074/#1220; `/op-data-scan` before PR |
| R10 | **AGPL-3.0 constraint** — a GPL-licensed scorer, judge or OCR dependency contaminates the dual-license structure | **high × rare**       | New dependencies restricted to Apache-2.0 or MIT; `tesseract.js` (already in use) is Apache-2.0; licence check via `/op-security` before PR                  |
| R11 | **Breaking change** — S2's result-shape change invalidates the recorded #1229 baselines                          | **low × possible**    | Additive fields only; bump `schemaVersion` on fixtures; re-run and re-record both shipped baselines in the same PR                                           |
| R12 | Disk and time cost — 19.5GB per 32B candidate, multi-hour dense-32B sweeps                                       | **low × likely**      | Candidate subsetting via CLI flag; document per-candidate footprint; dense-32B legs opt-in                                                                   |
| R13 | Scope creep into pipeline fixes — grounding findings argue for work that belongs to #1209/#1212                  | **medium × possible** | Hard boundary in §3; findings are filed as issues, not patched here                                                                                         |
| R14 | `pnpm test:ci` (`pnpm -r test -- --coverage`) breaks repo-wide if the new `test` script rejects the flag          | **medium × possible** | Use jest, which accepts it natively, or a wrapper that ignores unknown flags; verify `pnpm test:ci` at the repo root before PR                               |
| R15 | R4 changes provider interfaces under the generation leg mid-flight                                               | **medium × possible** | Adapter confined to `src/backends/`; depend only on `ILLMProvider.generate()` and the `PromptClientService` public API                                       |

### Migration safety

**Not applicable — no migration.** The harness has no schema, no table and no runtime surface; it
reads committed snapshot fixtures and drives providers directly. This is also the reason the work
stays inside `packages/eval-harness` rather than adding eval endpoints to `region` or `knowledge`.

### The trap metric, recorded so it is not re-introduced

A 3.4B granite build topped the first scoreboard at 16/18 fields **because it fabricated the fiscal
impact**, while qwen scored lower for correctly returning an empty `fiscalImpact` — the honest answer,
since AG-filed initiative text carries no fiscal analysis. All six models returned empty
`fiscalImpact` on all five measures: that is a property of the source data, not a model failure, and a
naive eval misreads it as one. **Field completeness must never be scored.**

## 7. Effort

| Group                                        | Sessions |
| -------------------------------------------- | -------- |
| Core — S0–S4, both exit criteria met          | ~5.5     |
| Completeness — S5–S7                          | ~2.25    |
| Deferrable — S8                               | 0.75     |
| Docs / wiring — S9                            | 0.5      |
| **Total**                                     | **~9 sessions ≈ 6–7 working days** |

## 8. MVP-deadline note

Both CLAUDE.md files carry MVP dates now passed (2026-07-04 workspace, 2026-09-01 monorepo). This work
is internal instrumentation with no citizen-facing surface, so it carries no launch-date risk of its
own. But the defect it quantifies **is** citizen-facing: claim-span anchoring measures 8/121 — under
7% — across every model tested, and `normalizePayload` clamps the bad offsets into spans that render
to citizens as precise attribution. That argues for prioritising #1212 alongside this work, not for
expanding this issue's scope.
