# Plan: proposition analysis fails silently

| | |
|---|---|
| **Issue** | [#1085](https://github.com/OpusPopuli/opuspopuli/issues/1085) — Four propositions silently have no AI analysis, and nothing reports it |
| **Date** | 2026-08-30 |
| **Author** | Rodney Gagnon |
| **Branch** | `fix/proposition-analysis-missing-1085` |
| **Data classification** | **None.** Propositions are public filed records. Active profile is `us-state-privacy` + `soc2` per `.claude/compliance-profile.yaml`; no CCPA personal information is read, written, logged or sent to a model by this change. |
| **Migrations** | One, additive: two nullable columns on `propositions`. No drops, no renames. |
| **Federation** | None in subtasks 1–5. Surfacing the failure state in GraphQL is out of scope. |
| **Dependencies** | None new. No AGPL-3.0 conflict. |
| **Origin** | Found while implementing #1074 Phase B. Affects the propositions surface independently of scanning. |

## One line

Make a failed proposition analysis say so — by measure, with a reason — and
only then fix the long measures, using what the reasons turn out to be.

## Why observability first, and not "just fix the long ones"

The issue's diagnosis is that input length degrades the model into emitting
unparseable JSON. That is a reasonable inference from the code, but it has
never been observed: the one place a reason is written is `logger.debug`, and
`NODE_ENV=production` means 0 DEBUG lines in 12h of region logs. The lines were
never written — they were not rotated away, which is what the first
investigation assumed.

Chunking, map-reduce, and summarise-then-analyse are three different fixes for
three different failure signatures. Choosing one now is guessing.

## What the code actually does (traced 2026-08-30)

`proposition-analysis.service.ts`. There are **four** silent paths, not the two
the issue names:

| Path | Today |
|---|---|
| `parsePayload` — no JSON object in the response | `logger.debug` (L279) |
| `parsePayload` — `JSON.parse` throws | `logger.debug` (L288) |
| `normalizePayload` — `analysisSummary` missing | **returns `undefined` with no log at any level** |
| `tryGenerateAndPersist` — `if (!result) return false` | no log |

So a measure can fail without writing a single line even with DEBUG enabled.
The `catch` in `tryGenerateAndPersist` *does* `logger.warn` — a thrown error is
reported and a returned-`undefined` is not, and the quiet one is the one that
actually happens.

**The most diagnostic field is being discarded.** `ILLMResult` carries
`finishReason?: 'stop' | 'length' | 'error'`
(`packages/common/src/providers/llm/types.ts:64`) and `generateOne` throws it
away. If it reads `length`, the output hit the 2000-token
`PROPOSITION_ANALYSIS_MAX_TOKENS` cap mid-JSON and the story is **output
truncation**, not input degradation — the opposite of the issue's technical
note, and the one thing it warns against "fixing" by raising that cap. One
logged field decides it.

**The blindness is systemic.** Six services extend `LlmGeneratorBase`;
`bio-generator.service.ts` and `committee-summary-generator.service.ts` carry
the same `logger.debug`-on-parse-failure shape. Every AI generation surface in
`region` fails this quietly. This plan fixes propositions and leaves a primitive
the other five can adopt, rather than rewriting six services at once.

**`region` has no `MetricsService` wiring at all** — which is why subtask 4
records the failure on the row instead.

## Subtasks

### 1. A typed failure instead of `undefined`
**Service:** `region`

`generateOne` returns a discriminated result rather than
`payload | undefined`. Failure carries `reason`
(`no_json` · `parse_error` · `no_summary` · `llm_error`), `finishReason`,
response length and input length. No response text.

**Files:** `src/apps/region/src/domains/proposition-analysis.service.ts`

**Tests:** unit per reason, including that `finishReason` is carried through
and that no response body reaches the log.

### 2. Report at warn, and name the failures
**Service:** `region`

Every failure path logs at `warn` with the measure's `externalId` and the
reason. `generateMissing` replaces the bare `Generated 4/8` with the count plus
the failed measures and their reasons.

**Files:** as above, `+ *.spec.ts`

**Tests:** `generateMissing` names each failure; the success path stays quiet.

### 3. Leave a primitive in the base
**Service:** `region`

A shared failure-reason type and a `logGenerationFailure` helper on
`LlmGeneratorBase`, adopted here by `PropositionAnalysisService` only. Additive:
the other five services keep compiling and behaving exactly as they do now, and
can adopt it one at a time.

**Files:** `src/apps/region/src/domains/llm-generator.base.ts`

**Tests:** unit on the helper.

### 4. Make "unanalysable" a state, not an absence
**Service:** `region` · **Migration:** additive

`propositions.analysis_failure_reason` (text, nullable) and
`analysis_failed_at` (timestamptz, nullable). Written on failure, cleared on
success.

Chosen over a Prometheus counter because it satisfies both criteria at once —
"visible without reading logs" and "explicitly and visibly recorded as
unanalysable" — costs one additive migration, and needs no new metrics wiring
in a service that has none. A counter is the better instrument for a *rising*
rate and is a reasonable follow-up; it is not a substitute for the row knowing
its own state.

**Files:** `supabase/migrations/`, `packages/relationaldb-provider/prisma/schema.prisma`, the service

**Tests:** integration against a real database — failure writes the reason,
a later success clears it.

### 5. Re-run the backfill against production and read the reasons — GATE
**Ops, no code.**

`backfill-proposition-analysis` against production, off-cron, capturing the
per-measure warning for all four measures. Produces the failure signature that
subtask 6 is designed against.

Run off-cron and capped: this shares Ollama with the nightly job.

### 6. Fix the long measures — DESIGN GATED ON 5
Deliberately unspecified. If subtask 5 returns `finishReason: 'length'`, the
fix is about output budget and streaming/segmented generation. If it returns
`no_json` with `finishReason: 'stop'`, the model is rambling and the fix is
prompt-side — which lives in the private `prompt-service` repo and needs a
cross-repo release. Writing either design now would be inventing evidence.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Response text logged as "context" | low × possible | Log lengths, reasons and `finishReason` only; asserted in the spec |
| Base-class change touches six services | medium × possible | Additive only; adopted by one service in this PR |
| The length fix needs a prompt-service template | medium × likely | Gated behind subtask 5; separate PR and release |
| Prod backfill competes with the nightly cron for Ollama | medium × likely | Run off-cron, cap with `PROPOSITION_ANALYSIS_MAX_PROPS` |
| Raising `MAX_TOKENS` looks like the fix and is not | medium × likely | `finishReason` decides it on evidence, not inference |
| Failure columns drift from reality if never cleared | low × possible | Cleared on success in the same update; integration-tested |

## Effort

| | |
|---|---|
| Subtasks 1–4 | ~1 day |
| Subtask 5 | half a day plus run time |
| Subtask 6 | unknown by design — that is the point of the gate |

## Out of scope

- Adopting the primitive in the other five generators — follow-up, one at a time
- A Prometheus counter for region generation failures — follow-up
- Surfacing the failure state in GraphQL or the frontend
