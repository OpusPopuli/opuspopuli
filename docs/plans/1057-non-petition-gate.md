# Plan: Non-petition classification gate

| | |
|---|---|
| **Issue** | [#1057](https://github.com/OpusPopuli/opuspopuli/issues/1057) |
| **Date** | 2026-08-23 |
| **Author** | Rodney Gagnon (plan drafted by Claude, approved by Rodney) |
| **Data classification** | **No new regulated-data flows.** Scanned text already goes to the self-hosted LLM (existing posture, in trust boundary). New rule introduced here: the skip **reason is a closed enum** (`not_a_petition` \| `unreadable`) and never echoes document text — a bogus scan can be someone's personal letter, and a free-text reason would leak it into logs and the analysis cache. Strict PHI/PII lens (no `.claude/compliance-profile.yaml`). |
| **Migrations** | **None.** The verdict lives in the existing `documents.analysis` Json column. No new dependencies (AGPL-safe). |
| **Branch** | `feat/non-petition-gate-1057` |
| **Status** | Approved 2026-08-23. |

## One line

Stop the scanner from confidently analyzing non-petitions: classify first,
and give bogus documents an honest "this doesn't appear to be a petition"
answer instead of fabricated analysis.

## Context (traced 2026-08-23, recorded in #1057)

The pipeline has no authenticity gate. Camera document-detection (#1048) is
shape-only; OCR confidence is displayed but never gates; the
`document-analysis-petition` template unconditionally "analyzes this
petition" — every bill template has a `{ skip: true }` sentinel for
non-bills, the petition template has nothing — and the results page renders
whatever comes back with full visual authority. Related but separate:
matching against real measures (#1040, the *verification* half) — this plan
is the *rejection* half.

## Subtasks

### 1. prompt-service: classification-first petition template
File the companion prompt-service issue (per the #1052/#103 pattern), then
revise `document-analysis-petition`: the LLM first decides *is this text a
petition?* and returns `{ "skip": true, "reason": "not_a_petition" |
"unreadable" }` when it is not — mirroring the bill templates' sentinel.
**Conservative bias**: skip only when clearly not a petition; a real
signature sheet must never be rejected (launch demo 2026-08-27).
**Tests:** prompt-service unit + integration (rendered prompt carries the
classification contract; both verdict shapes).

### 2. documents: sentinel handling + minimum-text pre-gate
**Files:** `analysis.service.ts`, `dto/analysis.dto.ts`, metrics.
Before the LLM call, a minimum extracted-text threshold → verdict
`unreadable` without paying for inference. Parse the sentinel → persist
`{ isPetition: false, skipReason }` in the analysis Json (cached by
`(contentHash, type)` like any analysis — the same menu rescanned by anyone
resolves instantly), skip proposition linking and completeness scoring.
DTO gains optional `isPetition` / `skipReason` fields — **additive
federation change; validate gateway composition per CLAUDE.md.**
Note: nodes running DB-templates fallback mode (no `PROMPT_SERVICE_URL`)
keep the old template and won't classify — the min-text gate still applies
there; degraded-but-safe, prompt text stays server-side per the IP boundary.
**Tests:** unit (skip path, pre-gate, linking not called) + real-DB
integration (verdict cached and shared by contentHash; `forceReanalyze`
recovers a false negative).

### 3. frontend: honest rejection state
**Files:** petition results page, new component, en/es locales.
Branch on the verdict: "This doesn't appear to be a petition" + rescan CTA;
suppress share/track and the personalized-impact section; keep the
report-issue affordance as the false-negative escape hatch. Optional: a
distinct badge in My Scans history instead of "analyzed". WCAG 2.2 AA;
petition pinned-dark surface uses on-inverse/fixed tokens per #1047/#1055.
**Tests:** component + axe.

### 4. skip-rate telemetry + end-to-end verification
A skip-outcome metric so a mis-tuned prompt rejecting real petitions is
visible before launch day. Verify end-to-end with a menu image and a real
petition image.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Real petition rejected (false negative) at launch demo | **High × Possible** | Conservative prompt bias; skip-rate metric; report-issue escape; `forceReanalyze` recovery |
| LLM (qwen3.5:9b) classification unreliability | Medium × Possible | Closed reason enum; JSON self-check in template; stubbed-LLM tests in both directions |
| Cross-repo template/parser contract drift | Medium × Possible | Lockstep tests on both sides (pattern established in #1052) |
| Cached wrong verdict served to everyone with the same contentHash | Medium × Rare | Same semantics as the existing analysis cache; `forceReanalyze`; report-issue |
| Skip reason leaks document text into logs/DB | Medium × Rare | Enum-only reasons, no free text |
| Breaking change to AnalyzeDocument consumers | Low × Rare | Fields are additive and optional; absent sentinel ⇒ behavior identical to today |

## Effort

~2 focused sessions: prompt-service ~0.5, documents ~0.75, frontend ~0.5,
verify ~0.25.

## Explicitly out of scope

- #1040 — circulating-initiative ingestion (the verification half; its own
  launch-critical track).
- #1050 — VLM OCR provider (could one day classify + extract in one pass;
  the gate must not wait for it).
- Camera-side content classification.
- Any change to the generic/contract/form analysis templates.
