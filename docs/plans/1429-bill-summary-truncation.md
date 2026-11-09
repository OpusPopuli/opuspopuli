# #1429: bill summaries stored from a partial read

| | |
|---|---|
| Issue | [#1429](https://github.com/OpusPopuli/opuspopuli/issues/1429) |
| Date | 2026-11-09 |
| Author | Rodney Gagnon (plan drafted with Claude Code) |
| Approved | Owner, 2026-11-09. D1 as recommended; D2 and D3 wait for subtask 4's measurements |
| Branch | `fix/bill-summary-truncation-1429` |
| Data classification | Public civic data only (bill text and summaries). No CCPA personal information. Logs carry bill numbers and token counts, never prompt or model text |
| Context | Window B critical path, item 1 (`production-cutover-maintenance-window.md` §1a). UAT has to regenerate the affected summaries before the corpus freeze (D3a) |

## Problem

The bill status summary saves whatever the model returns, even when the model
read only part of the bill. The summary is keyed on the export
`sourceVersion`, so a summary written from half a bill counts as fresh for
good. When a prompt exceeds `num_ctx`, llama.cpp reads **half the window**
(`num_ctx / 2 + 2` tokens), and the `MIN_PROMPT_COVERAGE` ratio check
(0.5 of a chars/4 estimate) only catches that by luck. It flagged SB 105 by
one point. A bill a little over the window reads at ~53% and passes.

Production and UAT run `nemotron-3.5-lightning:30b-a3b` at `num_ctx` 131072.
SB 105 needs 145,501 real tokens.

## Design

**Provider (`packages/llm-provider`, `packages/common`)**

- `detectPromptTruncation` also flags the exact half-window fingerprint,
  `tokensIn === floor(contextTokens / 2) + 2`, whenever the window is known
  and the estimate is above 0.6 of the window (a prompt genuinely that long
  must not be flagged forever). The ratio check stays.
- `GenerateOptions.refuseIfPromptExceedsContext` (opt-in; `generate` and
  `chat`). When set and the window is known, `assertPromptFits` decides
  before any call: `ceil(chars / 4 × 1.15) + (maxTokens || 512) > contextTokens`. 1.15 covers the
  chars/4 undershoot measured on nemotron (9% on SB 105). On refusal the
  provider throws `PromptTooLargeError`, which carries the estimate, the window
  and `maxTokens`.
- The check runs **caller-side** in `withLaneQueue`, before enqueue, as well as
  in `OllamaLLMProvider.generate`. A typed error does not survive the Redis
  lane queue, so a consumer-side refusal would reach the caller as a generic
  failure. A refusal never reaches the circuit breaker or the host-memory gate.

**Bills (`region-sync.service.ts`)**

- `summarizeBill` asks for the refusal and has two new outcomes:
  - `tooLarge`: refused before the call, so no GPU time was spent.
  - `truncated`: the result was flagged, and `writeStatusSummary` is never
    reached.
- Both go through `recordSummaryFailure`. It sets only `aiSummaryFailedAt`, so
  an existing summary and its `sourceVersion` are kept: the bill stays stale
  and is retried after `SUMMARY_RETRY_AFTER_DAYS`. A good summary is never
  replaced by a partial one.
- The phase-complete line counts both (`too-large`, `truncated` buckets and
  `pipeline_items_total` reasons), and so does `bill_enrichment_summary`.
  `truncated` is an error, so a run of them trips the phase's
  consecutive-failure abort: with the pre-flight in place, that means its
  estimate is wrong for the model, and stopping beats a discarded prefill per bill.

**D1 (decided):** no migration. A "too large" outcome is recorded as
`aiSummaryFailedAt`, plus the phase-line count and a warn log. A reason column
would only make the outcome queryable later, and Window B doesn't need that.

## Subtasks

1. Provider: the fingerprint, the pre-flight, and `PromptTooLargeError`, in both the direct and lane paths.
2. Bills: the two outcomes, keeping existing summaries, the counts.
3. Docs: the provider doc comment, this file, the cutover plan.
4. UAT (after merge): measure how many CA bills exceed 131072 (acceptance
   criterion 5), and how many stored summaries could have come from a partial
   read (bill size against `aiSummaryGeneratedAt` and the date UAT got
   131072). Then clear those through the app's own path and regenerate.
   **D2** (no summary vs raising `num_ctx` to 262144) and **D3** (the
   regeneration threshold) are decided on those numbers.

No GraphQL change, no federation impact, no migration.

## Tests

The four acceptance-criteria cases and their supporting cases, each confirmed
by reintroducing the bug:

- ratio-truncated (existing behaviour, kept)
- fingerprint-truncated at ~53% coverage, which the ratio misses
- no fingerprint when the window is unset
- pre-flight just under and just over the limit; the lane wrapper refuses without enqueueing
- bills: a truncated result is not written and is retried; a refused bill makes no LLM call; an existing good summary survives; a normal full read still writes

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Truncated summaries already in UAT ship in the corpus | high × likely | Subtask 4 clears and regenerates; the D3a freeze checks for them |
| The typed error is lost crossing the lane queue | high × likely (if consumer-side only) | Caller-side check in `withLaneQueue`, tested to enqueue nothing |
| The pre-flight refuses a bill that would have fit | medium × possible | Factor calibrated on nemotron; refusals counted; D2 is the escape hatch |
| The fingerprint differs on Ollama 0.40.15 (Studio) vs 0.34.3 (Mac) | medium × possible | Ratio and pre-flight remain, and the pre-flight doesn't depend on the version. Verify on a UAT run |
| The fingerprint flags more results for other callers | low × possible | Civics already re-runs truncated results, which is wanted; the refusal is opt-in |
| A stale `common` build breaks the hooks | low × possible | Rebuild `common` before committing |
| Licence | none | No new dependencies |

## Effort

About one session for subtasks 1–3. Subtask 4 is a few hours of UAT run time plus about half a session.

## Review (2026-11-09, on the final diff before commit)

Self-review by the author's agent, plus an independent subagent review of the
same diff. **No blockers.** Acted on:

- Phase line: `tooLarge` and `truncated` get their own buckets and reasons (as `applyVotesResult` does)
- Fingerprint size floor (0.6 of the window)
- Truncation log uses prompt characters, not bill characters
- Tests added: batch counting and labels; the error surviving `withLaneMetrics(withLaneQueue(...))`, the production chain; the floor. Each mutation-checked

Accepted, not changed:

- A refusal still records a failed `llm` stage observation in `withLaneMetrics` (near-zero duration). Refusals are rare; moving the check outside the metrics wrapper would split the lane rule across two places.
- A refused bill is retried weekly. That costs a bill-text read and a prompt-service call, but no GPU time. Acceptable at the expected count, which subtask 4 measures.
- `generateStream` doesn't run the pre-flight. No stream caller sets the option, and the option's doc says so.

**Needs a human countersign** for separation of duties.
