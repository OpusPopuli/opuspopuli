# Move PdfExtractHandler's inline prompt to prompt-service (#1414)

| | |
|---|---|
| **Date** | 2026-10-28 |
| **Author** | Rodney Gagnon (with Claude Opus 5.5) |
| **Issue** | #1414 |
| **Related** | #1246 (no hardcoded prompt fallbacks), #1234 (OCR prompts moved the same way), #1143 (prompt text is public), `representatives-phase-b.md` (where this was found), `ingestion-resource-lanes.md` §10.2 (meetings is next) |
| **Data classification** | No new data flow. The prompt carries public civic PDF text (the Senate Daily File) and region config. No personal data. |

## Why

`PdfExtractHandler.buildAnalysisPrompt` and `getRequiredFields` build an LLM
prompt in code. It is the last inline prompt in the repo, and it is live: the
California `meetings` source for the Senate Daily File (`sourceType: "pdf"`)
runs it on every meetings sync.

Inline prompt text has no version or hash and isn't published, so nothing it
produces can be traced to a prompt. That breaks the attestation rule (CLAUDE.md,
"Prompt templates — source-of-truth boundary").

Meetings is the next type in Phase B. Its attribution step records which prompt
produced each output, and that can't start while this prompt is inline.

## What changes

### prompt-service: seed only, no new endpoint

The OCR move (`311422a`) is the precedent: consumers resolve templates by name
through the generic lookup, so the seed is the whole server-side change.

| Template | Variables | Text |
|---|---|---|
| `pdf-text-rules` | `CONTENT_GOAL`, `DATA_TYPE`, `HINTS_SECTION`, `REQUIRED_FIELDS`, `TEXT` | today's `buildAnalysisPrompt` literal, character for character |
| `pdf-text-rules-fields-meetings` | none | today's `meetings` branch of `getRequiredFields` |
| `pdf-text-rules-fields-propositions` | none | the `propositions` branch |
| `pdf-text-rules-fields-representatives` | none | the `representatives` branch |
| `pdf-text-rules-fields-default` | `DATA_TYPE` | the `default` branch |

All five use category `structural_analysis`, since they do the same job as
`structural-analysis`: the model writes extraction rules rather than content.
Only `meetings` is used by any region today. The other three data-type branches
are kept so the move changes nothing. Pruning them is a separate decision.

### prompt-client

`getPdfTextRulesPrompt({ dataType, contentGoal, hints, text })` returns
`PromptServiceResponse`:

1. Fetch `pdf-text-rules-fields-<dataType>`, falling back to
   `pdf-text-rules-fields-default`, and interpolate `DATA_TYPE` into it.
2. Build `HINTS_SECTION` exactly as the handler does today:
   `"## Hints\n" + bullets + "\n\n"`, or `""` when there are no hints.
   `composeStructuralAnalysis` and `composeCivicsExtraction` build their
   `HINTS_SECTION` in client code the same way.
3. Interpolate `pdf-text-rules`, then return `promptHash` and `promptVersion`
   for **that** template.

**Hash scope, a known limitation.** The hash covers the main template, not the
fields template. This matches `structural-analysis`, which doesn't hash
`structural-schema-<type>` either. prompt-service's `verifyPrompt` checks one
template at a time, so a combined hash couldn't be verified there. Editing a
fields template therefore changes the prompt without changing its hash. That is
true of the HTML path today too, and fixing it belongs to the verification
design, not this move. No open issue covers it. I searched both repos for "auxiliary
template hash", "structural-schema hash" and "schema template not hashed". The
nearest is #655 item 4, a drift catcher for prompt changes that don't bust
`promptHash`. That is related but a different mechanism. This plan is the
record.

### scraping-pipeline

- `PdfExtractHandler` injects `PromptClientService`, as
  `StructuralAnalyzerService` does. `buildAnalysisPrompt` and
  `getRequiredFields` are deleted.
- The handler returns `promptHash` and `promptVersion` on `ExtractionResult`.
  These are two new optional fields on the common type, set on success and on
  failure after the prompt was fetched.
- Persisting them on meeting rows is meetings Phase B (attribution), not this
  change.

### Failure mode

The client throws if the templates are unseeded (#1246, no fallback). The
handler already catches every error into `errors[]` and returns an empty
result. An unseeded prompt-service therefore turns the Senate Daily File source
into a loud zero-item source with the error in the sync result. It doesn't fall
back silently to some other prompt.

**Deploy order:** prompt-service must be seeded before a backend carrying this
change runs. In dev and UAT, that means running prompt-service's `db:seed`
before rebuilding the region-worker.

## Equivalence: byte-identical prompt

The real seed text exists only in prompt-service, and opuspopuli's prompt-client
specs run against mock templates. The guard is therefore split across the two
repos.

- **prompt-service**, `seed-pdf-text-rules.spec.ts`, alongside
  `seed-proposition-contracts.spec.ts`. It renders the seeded templates with the
  client's composition rules: fields fallback, `DATA_TYPE` in the fields
  template, the `HINTS_SECTION` shape and single-pass interpolation. The result
  is compared with a frozen copy of today's `buildAnalysisPrompt` and
  `getRequiredFields`, kept in the spec as the legacy reference. That covers
  every data type, both with and without hints. prompt-service is where prompt
  text is allowed to live, so the frozen copy belongs there.
- **opuspopuli prompt-client.** Mock-template specs cover the template names
  read, the fields fallback, `DATA_TYPE` in the fields template, the exact
  `HINTS_SECTION` bytes, the hash and version of the main template, and the
  throw when it is unseeded.

Verify both by mutation. A one-character change to the seed must fail the
prompt-service spec, and changing the hints heading in the client must fail the
client spec.

## UAT

- **Before:** `meet-b0`, a meetings sync on current `main`, records the Senate
  Daily File items extracted.
- **After:** seed prompt-service, rebuild region-worker, then `meet-b1`. Expect
  the same items, and a result that carries `promptHash`.

Generation is temperature 0.1 rather than greedy, so if the counts differ, check
run-to-run variance on `main` before blaming the move.

**`meet-b0`, measured 2026-10-28 on `main` at `64e91e1f`:** succeeded in 71 s.

The Senate source resolved `SEN_COM_2025_R_20261026.PDF`, extracted 40,752
characters, and the model produced 4 field mappings. The delimiter split the
text into **2 blocks**, and **both were rejected** by the meetings schema
(`scheduledAt: Invalid Date`).

The dev DB holds **0 Senate meetings**: this source has never landed a row.
That is a meetings Phase B finding (step 0, and the date transform or the
rules). It is not this change's to fix, and the plan is the record.

The PDF also changes from day to day, so "same items" can't mean the same rows.
**`meet-b1` passes when the same shape recurs:** the PDF path runs, the rules
parse, items are extracted, any rejections are for the same reason, and the
result carries `promptHash`. The byte-equality spec is the proof that the
prompt is unchanged.

## Risks

| Risk | Mitigation |
|---|---|
| Seed text drifts from the old literal, e.g. whitespace or backticks | Byte-equality spec, verified by mutation |
| Backend ships before the seed | Loud zero-item source with the error recorded, never a silent fallback. Deploy order noted |
| Extra prompt fetch per PDF source per sync | Remote cache with server `expiresAt`. One fetch an hour at most |

## As built

As planned, with one addition. The handler's existing
`AI produced N field mappings` log line now names the prompt:
`(pdf-text-rules v1 <hash12>)`. Until meetings Phase B persists the hash, that
line is the only place an operator can see it.

- **prompt-service** (`feat/pdf-text-rules-1414`): five seed entries,
  generated mechanically from the handler's source rather than retyped.
  `seed-pdf-text-rules.spec.ts` covers 5 data-type and hints cases plus a check
  that each template declares exactly the variables its text uses. The legacy
  reference is spliced from the handler at `64e91e1f`.
- **prompt-client:** `getPdfTextRulesPrompt` and `PdfTextRulesParams`, with 5
  specs.
- **common:** `ExtractionResult.promptHash` and `promptVersion`.
- **scraping-pipeline:** the handler injects `PromptClientService`, and
  `buildAnalysisPrompt` and `getRequiredFields` are deleted. There are 3 new
  specs: attestation on success, attestation on a rules failure, and an
  unseeded prompt failing loudly without calling the model.

**Mutation checks, each reverted afterwards:**

| Mutation | Result |
|---|---|
| A `.` added to one line of the `pdf-text-rules` seed | 5 of 6 prompt-service tests fail |
| `meetings` fields text changed | 2 fail (the meetings cases) |
| Client hints heading changed to `## Hint` | 1 fails |
| Handler stops spreading attestation onto a success | 1 fails |

**Tests:** prompt-service 324/324, prompt-client 121/121, scraping-pipeline
623/623, typecheck clean. prompt-service's `tsc --noEmit` reports two TS4058
errors in `test/integration/utils/fixtures.ts`, and those are on `main`
unchanged.

**UAT seed:** the UAT prompt-service image was rebuilt from the branch. Its boot
seed wrote all five templates at v1 under `structural_analysis`, 40 templates in
total.

**`meet-b1`, after the change:** succeeded in 10 s. Both runs fetched the same
PDF, `SEN_COM_2025_R_20261026.PDF`, so this comparison is like-for-like.

| | `meet-b0` (main) | `meet-b1` (branch) |
|---|---|---|
| PDF text | 40,752 chars | 40,752 chars |
| Field mappings | 4 | 4 |
| Delimiter | weekday headings | the same |
| Blocks / items | 2 / 2 | 2 / 2 |
| Rejected | 2, `scheduledAt` | 2, `scheduledAt` |
| Prompt | inline, unattested | `pdf-text-rules v1 52ae8b92fb29` |

`52ae8b92fb29` equals `sha256(template_text)` of the seeded row, computed in
the prompt-service DB.

`meet-b1` was faster because the Assembly manifest had been re-derived in
`meet-b0`. Nothing about the PDF path changed.
