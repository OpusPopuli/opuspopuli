# Plan of record — #1292: the verify-or-snap gate

| | |
|---|---|
| **Issue** | [opuspopuli#1292](https://github.com/OpusPopuli/opuspopuli/issues/1292) — sub-issue of [#1208](https://github.com/OpusPopuli/opuspopuli/issues/1208) (M2 — Evidence Graph); overlaps [#1209](https://github.com/OpusPopuli/opuspopuli/issues/1209) (M3) |
| **Date** | 2026-09-19 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/verify-or-snap-gate-1292` |
| **Data classification** | Public civic records. The verifier reads stored source text that can contain proponent contact details (#1263); it emits verdicts and offsets, never source content. |
| **Depends on** | #1291 (merged) — `Claim`/`Evidence` tables and `resolveEvidenceSpan` |
| **Reads first** | `docs/plans/1291-claim-evidence-core.md`, `docs/plans/1212-claim-anchoring-quote-then-locate.md` |

## 1. The check already exists, in a package production cannot import

`packages/eval-harness` is `private: true`. Its `scoring/anchoring.ts` holds
exactly the logic this gate needs, and it is the code that produced the **2%**
anchoring figure this issue is built around:

- `supportRatio(claim, span)` — fraction of the claim's content words present
  in the cited span.
- `MIN_SUPPORT = 0.3` — the threshold, set from a real failure (granite's
  clamped half-measure spans cite everything and support nothing in particular).
- Per-contract scorers for `offsets` and `quote-then-locate`, the latter
  already calling `locateQuote` from `@opuspopuli/common`.

This is the same situation #1212 hit with `redactContactDetails` and
`locateQuote`, and it takes the same answer: **move the scorer into
`@opuspopuli/common` and have both the harness and the gate import it.**

Not doing so makes this issue's own acceptance criterion unverifiable by
construction: "the 2% figure should be reproducible as a query after the
backfill" is only true if the gate and the measurement are the same code.

## 2. Verdict → state

| Harness verdict | `EvidenceState` | Note |
|---|---|---|
| `anchored`, span matches stored | `verified` | |
| `anchored`, quote located elsewhere | `snapped` | span corrected to where the text actually is |
| `unsupported` / `out-of-range` / `empty-span` / `quote-not-found` / `missing-anchor` | `unverified` | checked, not supported |
| no citation at all | `unsourced` | `bio_claims`' `origin: 'training'` |

Two consequences, both worth stating rather than discovering later:

**Legacy offset claims can be verified.** Vocabulary support is exactly how the
2% was measured, so the gate is not inert on legacy data — it will simply say
`unverified` about roughly 98% of it. That is the honest answer, not a defect,
and a gate that reported better numbers on this corpus would be broken.

**Snapping applies only to quote-bearing evidence.** With offsets alone there
is nothing to snap *to*: no quote to relocate. Legacy claims therefore land
`verified` or `unverified`, never `snapped`.

## 3. A code/comment inconsistency, corrected as part of the move

`supportRatio`'s doc comment says it is "reported as a number rather than used
as the pass/fail gate". Both `scoreOffsetClaim` and `scoreQuoteClaim` do
`verdict: support >= MIN_SUPPORT ? "anchored" : "unsupported"` — it **is** the
gate. The comment was accurate about intent and is now wrong about behaviour.

That is tolerable in a dev harness and not tolerable here, because the same
number is about to decide whether a citizen-facing citation is labelled
verified. Corrected in the move, not silently.

## 4. Subtasks

| # | Work |
|---|---|
| **S1** | Move `supportRatio` / `MIN_SUPPORT` / verdict logic into `@opuspopuli/common`; harness imports it rather than owning it |
| **S2** | `EvidenceVerifier` — resolve the span (#1291's resolver), apply the scorer, emit a state plus the corrected span when snapping |
| **S3** | Reproduce the harness's verdict distribution as a query over `evidence.state` |
| **S4** | Unit + integration tests: a claim that verifies, one that snaps, one in range but unsupported, one stale, one unsourced |

## 5. Out of scope

No dual-write (#1293) and no backfill (#1294). This issue produces the gate;
nothing calls it in anger yet. That ordering is the epic's, and it exists so
the gate is testable before it is load-bearing.

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Gate and harness drift, making the 2% unreproducible | **high** × likely | One implementation in `@opuspopuli/common`, imported by both. The precedent (`locateQuote`, #1212) exists because the same drift already happened once |
| 30% vocabulary overlap is too weak for a citizen-facing "verified" | **high** × possible | Threshold surfaced explicitly in the plan and the PR rather than buried; it is the one judgement call here. Raising it later is a one-line change with a measurable effect |
| Snapping silently rewrites a citation to somewhere the model never pointed | medium × possible | `snapped` is a distinct state, never merged into `verified`; the corrected span is recorded as a correction |
| A verified label outlives the text it was checked against | medium × likely | The verifier runs against the same hash-checked resolver as #1291; a stale span cannot be verified |
| Legacy claims mostly land `unverified` and this reads as failure | low × likely | Documented here and in the issue: ~98% unverified is the measured truth of this corpus |

## 7. Effort

~1 focused session. The move is mechanical; the judgement is in §2 and §3.
