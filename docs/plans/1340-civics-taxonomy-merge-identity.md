# #1340 — one served entry per measure type

**Status:** in progress · **Branch:** `fix/civics-taxonomy-merge-identity-1340`
**Measured against:** dev `postgres`, California, 12 pages, sync finished
2026-10-07 01:11 UTC (prompt v6 on 11 pages, v5 on one — see #1335)

## The defect in one line

`getCivicsData` dedups measure types on `code`, and #1337 made `code`
page-dependent by design, so one type arrives under two identities and is served
twice.

## Why `code` became page-dependent

This is not a regression in #1337 — it is the grounding rule working as
specified. From `civics-grounding.ts`:

- name warranted by the page or the source's hints → the **name becomes the
  code**, "so the same classification arrives under one identity from every page
  that names it"
- only the code warranted → the abbreviation is **kept as-is**, because
  legitimate abbreviations exist and the Assembly glossary *defines* `AB`, `ACA`,
  `ACR`, `AJR`

Both branches are right per page. The Assembly glossary page spells `Assembly
Bill` out, so that row's code is `Assembly Bill`. The legislative-process pages
only use `AB`, which the source hints warrant, so those rows keep `AB`. Merging
on `code` then yields two entries for one type.

The grounding comment anticipated the remaining gap and said so: identity across
pages "needs the merge layer". This is that layer.

## Measured state

8 of 25 served types are duplicates. `name` is identical within every pair; only
`code` differs.

| name | codes seen | pages |
| --- | --- | --- |
| Assembly Bill | `AB`, `Assembly Bill` | 2, 1 |
| Senate Bill | `SB`, `Senate Bill` | 1, 3 |
| Assembly Constitutional Amendment | `ACA`, full name | 2, 1 |
| Senate Constitutional Amendment | `SCA`, full name | 2, 1 |
| Assembly Concurrent Resolution | `ACR`, full name | 2, 1 |
| Senate Concurrent Resolution | `SCR`, full name | 2, 1 |
| Assembly Joint Resolution | `AJR`, full name | 2, 1 |
| Senate Joint Resolution | `SJR`, full name | 2, 1 |

`HR` and `SR` appear as abbreviations only, with no spelled-out counterpart, so
they are not splits — a reminder that the fix must not *invent* a full-name code
where no page supplied one.

### What agrees, and what does not

Checked across all 25 rows for the 8 affected names:

| field | finding | consequence for the merge |
| --- | --- | --- |
| `chamber` | **agrees** everywhere | safe to take either |
| `votingThreshold` | **agrees** everywhere | safe to take either |
| `reachesGovernor` | **agrees** everywhere | safe to take either |
| `purpose` | differs a lot — Assembly Bill 317 vs 105 chars, ACR 509 vs 139, AJR 478 vs 129 | first-wins loses the better text |
| `lifecycleStageIds` | different **subsets** — Assembly Bill has 9, 11 and 8 | first-wins discards two sets |

Rows are read `orderBy: extractedAt desc`, so today's winner is whichever page
was extracted last. That is deterministic but arbitrary with respect to quality.

## Design

### Merge key

Normalised `name` — lowercased, whitespace collapsed — falling back to the
normalised `code` when `name` is empty. Names are the stable identifier here;
that is the measured fact this fix rests on.

### Which `code` survives

Prefer the **non-degenerate** code: one that differs from its own name. A code
equal to its name carries no information the name does not already have, so it
is the degenerate case and loses. Result: `code: "AB"`, `name: "Assembly Bill"` —
which is what a field called "code" should hold, and what a citizen recognises
from a bill number.

This is a judgement, so state it rather than bury it: if every copy is
degenerate, the name stands as the code, exactly as today.

### Field-by-field resolution

| field | rule | why |
| --- | --- | --- |
| `code` | non-degenerate wins; else first | above |
| `name` | first non-empty | they agree |
| `chamber`, `votingThreshold`, `reachesGovernor` | first non-empty, **disagreement reported** | they agree today, so a future disagreement is a signal and must not be silent |
| `purpose` | longest | crude but honest: the spelled-out pages are the glossary and process pages, which genuinely explain more, and the measured spread is 3–4× |
| `lifecycleStageIds` | de-duplicated union, insertion-ordered | the subsets are complementary, not competing |

`purpose` by length is the weakest rule here. The alternative — prefer the copy
whose name was warranted — is not available at merge time, because the warrant is
not persisted on the row. Recording the warrant in `civics_blocks` would make
this principled instead of heuristic; out of scope, noted in the issue.

### Conflict reporting

Mirrors `GroundingResult.conflicting` from #1337: collapsing is lossless when
copies agree and a judgement when they do not, so the disagreement is surfaced
rather than resolved in silence. No conflicts exist in the current data, which is
exactly why the reporting has to go in now — it will only ever fire on something
new.

## Outcome — verified, not asserted

The real 54 measure-type rows from the 12 California pages were fed through
`mergeMeasureTypes` as a read-only probe. **54 candidates → 17 served types, 0
conflicts**, which is the predicted number:

```
Initiative Statute                               Initiative Statute
Initiative Constitutional Amendment              Initiative Constitutional Amendment
Referendum                                       Referendum
Recall                                           Recall
Initiative Constitutional Amendment and Statute  Initiative Constitutional Amendment and Statute
Legislative Statute                              Legislative Statute
Legislative Constitutional Amendment             Legislative Constitutional Amendment
SB                                               Senate Bill
AB                                               Assembly Bill
ACA                                              Assembly Constitutional Amendment
SCA                                              Senate Constitutional Amendment
ACR                                              Assembly Concurrent Resolution
SCR                                              Senate Concurrent Resolution
AJR                                              Assembly Joint Resolution
SJR                                              Senate Joint Resolution
HR                                               House Resolution
SR                                               Senate Resolution
```

All eight split pairs collapsed with the abbreviation winning. `HR` and `SR`
stayed as they were. The seven ballot-measure types kept their full names as
codes, which is correct — no page supplied an abbreviation for them, and
inventing one would fabricate what no source said.

Stage unions landed too: `Senate Bill` now carries 15 stage ids and
`Assembly Bill` 11, where individual pages had 8–11 and 8–9.

## The design changed once, because a test caught it

The first implementation keyed on name alone. A **pre-existing** test —
"deduplicates measureTypes by code across rows" — failed immediately: two pages
can also agree on the code and disagree on the name, and name-only keying split
those. That is this same defect mirrored, so the fix would have traded one
direction of it for the other.

Identity therefore resolves on name **OR** code, as an equivalence grouping with
an alias index, which also forced the merge from an incremental Map into a single
pure pass over all candidates. Better outcome than the original design, and it
came from a test written by someone else months earlier.

## Deliberately out of scope

`mergeLifecycleStages` has a bigger, different problem — unstable *ids*
(`introduced`/`introduction`, four ids for one ballot-qualification stage) and
one id carrying up to six display names. Both candidate merge keys are unstable,
so there is nothing reliable to merge on and a key change cannot fix it. Filed as
**#1341**; it needs a canonical-identity decision first.

## Verification

1. Unit tests in `civics-merge.service.spec.ts`, each verified by reintroducing
   the bug it guards (`feedback_verify_regression_tests`)
2. `getCivicsData` exercised against the real dev rows, asserting 17
3. Full backend suite, `lint:sonar`, `jscpd`
4. `/op-review` and `/op-security` before commit, per `feedback_review_before_commit`

No GraphQL schema change: same fields, fewer and better-populated rows, so no
federation validation needed at the gateway.
