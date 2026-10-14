# Plan: admit incomplete expenditures, and disclose what the figure rests on (#991)

| | |
|---|---|
| **Issue** | [#991](https://github.com/OpusPopuli/opuspopuli/issues/991) — `EXPN_CD` ingests ~40% of its rows |
| **Status** | **ACCEPTED WITH CAVEATS 2026-10-14**, plus a post-merge correction the same day: `unattributed` was overstated ~10x. See both sections below. |
| **Adjacent** | [#992](https://github.com/OpusPopuli/opuspopuli/issues/992) subtask 5 is the same resync; [#983](https://github.com/OpusPopuli/opuspopuli/issues/983) assumes a complete expenditure set |
| **Decision taken** | `date` becomes nullable; the resulting gap is **stated in the public record** rather than absorbed silently |

## Problem

`ExpenditureSchema` requires both `date` and `payeeName`. CAL-ACCESS leaves both
blank on a large share of `EXPN_CD`, so those rows are rejected and the money on
them never reaches a total.

Measured 2026-10-12 against `dbwebexport.zip` (1.59 GB,
`last-modified: Mon, 12 Oct 2026 08:52:56 GMT`), counting with
`parseFlexibleDate` copied verbatim from `domain-mapper.service.ts`:

| | rows | dollars | share of dollars |
|---|---:|---:|---:|
| currently landing | 7,016,797 | $66.25B | 84.8% |
| rejected — blank `EXPN_DATE` | 5,232,951 | **$9.75B** | 12.5% |
| rejected — blank `PAYEE_NAML` | 3,811,692 | **$2.11B** | 2.7% |
| rejected — both | 292 | $0.01B | 0.0% |
| **rejected total** | **9,044,935** | **$11.87B** | **15.2%** |

Two findings that refine the issue:

- **The issue hypothesised dates only.** `payeeName: z.string().min(1)` rejects a
  nearly-disjoint 3.81M rows — 292 fail both — and is not mentioned in it.
- **Rows are not dollars.** We drop 56.3% of rows but 15.2% of money: the
  dropped rows average $1,863 (no date) and $553 (no payee) against $9,441 for
  accepted ones. `totalSpent` reads low by ~15%, not the ~60% the issue's title
  implies. Smaller than feared, and still $11.87B.

**Zero dates are unparseable.** Every non-blank `EXPN_DATE` parses — the file's
format is `1/19/2000 12:00:00 AM`, which `new Date(str)` accepts at step 1 of
`parseFlexibleDate`. So this is entirely about blanks, and no format-handling
work is hiding behind it.

**`AMOUNT` blank on 51,266 rows — this plan was WRONG about it twice**, and the
#1361 tally caught it on the live run (2026-10-14): those rows are
**rejected**, with `Expenditure.amount: Expected number, received nan ×51266`
— the count matching the archive measurement exactly. They are not coerced
to `0`.

The reason is the same key-presence mechanic that nearly lost the entire
payee half of this change: `mapRow` does `if (val) record[f] = val`, so a
blank cell yields **no `amount` key at all**, not `""`. `z.coerce.number()`
then coerces `undefined` → `NaN` → rejected. The claim assumed the value
arrives as an empty string, which the bulk path never produces. Twice in one
document, about one mechanic, in the direction that flattered the design.

## Decisions

**Admit the rows; disclose the gap** (decided 2026-10-12 by the owner). `date`
becomes nullable and the discrepancy is called out in the public record. The
standard is to get the numbers right *and* to say when we are not certain
because data is missing or conflicting.

Rejected: keeping the rejection. A transparency platform understating spending
by $11.87B is worse than displaying a row with a missing field. The data is the
committee's own filing; dropping it hides money that was actually spent, and the
omission is invisible to a reader. The project settled the analogous question in
#1219 — "an empty summary is the honest representation of 'not extracted'" —
rather than discarding the record.

**`payee_name` becomes nullable on the same principle** (extended 2026-10-12).
The owner named `date`; the stated principle is "get the numbers right", and
leaving $2.11B out because a *payee* label is missing fails it for the same
reason. A payee-less expenditure still has an amount, a filing and a committee.
Flagged rather than assumed — pull it back if the intent was narrower.

**Three kinds of uncertainty are disclosed separately, not merged.** This is the
substance of the owner's instruction and the part most easily botched:

| | what it means | currently |
|---|---|---|
| undated money | the amount is known, *when* is not | rejected |
| unattributed money | the amount is known, *to whom* is not | rejected |
| unitemized money | we know it exists and have **no detail at all** — sub-$100 contributions reported only on a summary line | stored in `filing_reconciliations.unitemized_contributions` |

Collapsing these into one "figures may be incomplete" line would be exactly the
vagueness the above-reproach standard exists to prevent. The first two are
money we hold and cannot fully describe. The third is money we do not hold.

This also resolves **#992 open question 2** — "should the unitemized delta
appear on representative/proposition pages, or stay internal until a design
exists?" It appears.

**The ingest change and the disclosure ship together.** Landing $11.87B with no
explanation would be less defensible than today's understatement: every
committee total would move with nothing saying why.

## Subtasks

### 1. Make the columns nullable

- Migration via `/op-migration`: `expenditures.date` and `expenditures.payee_name`
  `NOT NULL` → nullable. Additive in the sense that matters — it widens what is
  accepted and drops nothing.
- `ExpenditureSchema`: `date: coerceBlankableDate`, `payeeName` optional.
  **`coerceFlexibleDateOptional` was the wrong helper and the plan said so in
  error.** It pipes `parseFlexibleDate` into `z.date().optional()`, and
  `parseFlexibleDate` returns `undefined` for a *malformed* value as readily as
  for a blank one — so both are accepted and the row then reports "no date
  reported by the filer" when the filer did report one we could not read. That
  is a false statement about someone's filing, and worse than the rejection it
  replaces. `coerceBlankableDate` (added for this) admits blanks and rejects
  malformed values with the same `Invalid date format` message, so the #1361
  tally still groups them. Zero non-blank `EXPN_DATE` values in today's archive
  are unparseable, so it rejects nothing now; it exists so the day one appears,
  we say so rather than mislabelling it. A test guards the distinction.
- Keep `amount` required. A row with no amount carries no money and
  `z.coerce.number()` already admits `""` as `0`, which is its own small
  question and explicitly **not** in scope here.

**Acceptance — corrected 2026-10-13.** The 5,523,263 figure in subtask 3 is the
**pre-#991** prediction: it counts distinct keys passing the schema that
*required* date and payee, and it exists to diagnose the 639,142 residual. It
does NOT predict the post-#991 total, which is higher by the admitted blanks.
Verifying the resync against it would mark success at roughly the row count we
already had.

Three independent checks instead, two of them measured directly off the
archive rather than derived:

| check | target | what it proves |
|---|---|---|
| rows with BOTH a date and a payee | ≈ 5,523,263 | the 639,142 residual closed |
| `sum(amount) where date is null` | ≈ **$9.75B** | the undated half really landed |
| `sum(amount) where payee_name is null` | ≈ **$2.11B** | the unattributed half really landed |

The two dollar figures are the strong ones: they come from counting the raw
`EXPN_CD.TSV` with `parseFlexibleDate` copied verbatim, so they are
independent of anything the pipeline reports about itself. The reject tally
(#1361) should also report date and payee at ~0 — and, critically, total
admitted rows must not come in at the old count with the tally clean, which is
the signature of the routing drop this change already had to fix once.

**Done 2026-10-12.** Migration applied locally and verified
(`is_nullable = YES` on both columns); 98 mapper tests pass, including one
that pins the blank/malformed distinction. The GraphQL model, `nulls: 'last'`
ordering, the null→undefined boundary conversions and the frontend's
`dateNotReported` branch all landed with it.

### 2. Disclose the basis of every funding figure

`RepresentativeFunding` and `PropositionFunding` currently return a bare
`totalSpent` with no data-quality field at all. Add the basis:

- `undatedAmount` / `undatedCount` — money included in the total whose date is unknown
- `unattributedAmount` / `unattributedCount` — money included whose payee is unknown
- `unitemizedAmount` — money known to exist with no detail, from
  `filing_reconciliations.unitemized_contributions`
- `asOfSource` — the archive `last-modified`, so a reader knows which export the figure came from

Rules the surface must follow:

1. **Never show a bare total when a component is uncertain.** The figure and its
   caveat travel together or neither ships.
2. **Name the quantity, not a mood.** "$9.75B of $78.12B has no reported date"
   is a disclosure; "figures may be incomplete" is not.
3. **Distinguish "we hold it but cannot describe it" from "we do not hold it".**
   Undated and unattributed are the former; unitemized is the latter.

**Done 2026-10-12.** `FundingBasisService` computes all four, shared by both
funding services so the two surfaces cannot drift into disclosing the same gap
differently. `FundingBasisNote` renders it directly under the totals on both
pages. 11 component tests + 8 service tests, two of them mutation-verified.

Four things the implementation had to settle that the plan did not anticipate:

1. **`undatedAmount` and `unattributedAmount` overlap** — a row missing both is
   counted in each (292 rows of 9,044,935). They are never summed, and the note
   says so in words when both are present.
2. **The unitemized denominator is `totalRaised + unitemizedAmount`**, not
   `totalRaised`. Dividing by what we store would overstate our own coverage.
3. **A stale cache must be a miss, not a default.** Entries written before
   `basis` existed survive the 4-hour Redis TTL. Throwing would fail every
   funding query until expiry; substituting the all-zero basis would assert
   "nothing undated" about a figure nobody measured. Both services now treat a
   pre-#991 entry as a miss. The same hazard exists client-side via Apollo's
   IndexedDB persistence, where the note says the basis could not be determined
   rather than showing a bare total.
4. **`asOfSource` has no value to fall back on.** It comes from
   `bulk_snapshots.last_modified`; our own sync time is a different fact and is
   not substituted. An unparseable header is reported as unknown, never as the
   epoch.

`PropositionFundingSection` now also displays `totalSpent`, which was fetched
and discarded. The basis note discloses what share of *spending* lacks a date
or payee, and a caveat about a number the reader cannot see is not a
disclosure.

### 3. Resync, which is also #992 subtask 5 — and a release gate

**Found by querying the live local gateway 2026-10-12, and it changes the
release order.** The disclosure returns real data today: Dawn Addis shows
$96,942 unitemized, and one measure shows $3,817,131 unitemized against
$18,202,809 raised — 17.3%, previously invisible. But `undatedAmount` and
`unattributedAmount` come back **zero everywhere**, because the stored corpus
was ingested under the schema that rejected those rows. Every stored
expenditure has a date because the dateless ones were thrown away.

So "no expenditure on file is missing its date" is true of our database and a
false impression of the public record — the exact failure the above-reproach
standard exists to prevent, arrived at by telling the truth about the wrong
thing.

Mitigated in code rather than left to release discipline: the affirmative
all-clear is now conditional on `asOfSource`. With no dated source export we
can say no stored row is missing a field, not that nothing is missing. Since
`bulk_snapshots` is empty until a sync records one, the pre-resync window
discloses itself. **The resync is still required before this reaches
production**, because the conditional wording is a floor, not the goal.


One run serves both. #992's remaining subtask is "re-verify on a rebuild"; this
is that rebuild.

Prediction to diff against, from today's archive:

| | rows |
|---|---:|
| distinct passing keys, filings ≤ max stored | 5,482,383 |
| distinct passing keys, newer filings | 40,880 |
| **predicted total** | **5,523,263** |

Current `expenditures` holds 4,843,241. **A 639,142 residual (11.7%) between
today's prediction and today's stored rows is unexplained** and this resync is
what settles it: the `filing_id <= max(stored)` proxy is biased because amended
filings add new `TRAN_ID`s under pre-existing filing IDs, so growth cannot be
separated from loss without the matching archive. After the resync both sides
come from the same export and the comparison is sound.

### 4. Re-verify against #992's acceptance target

#992's baseline is the target: "ours higher" ≈ 0, unitemized explicit.
Independently confirmed 2026-10-12 — the plan predicted a true over-itemized
rate of 0.31% and measurement found 0.30% (515 / 173,804), down from 8/123
(6.5%). Re-run after the resync; the rate should hold.

Also re-check the 69 filings where `filing_reconciliations.amend_id` disagrees
with `max(amend_id)` of the detail (#992 item 1) — those verdicts compare two
versions of one filing and are meaningless until fixed.

## What review caught, and what it cost to fix

Three independent review lenses ran over the implementation. One finding was
**critical and would have made the whole change a no-op for half the money**;
the rest are recorded because the reasoning matters more than the diffs.

### The change did not work — the admitted rows were dropped one stage later

`sortCampaignFinanceItems` discriminates on field **presence**, because the
bulk TSVs carry no type tag: expenditures are `"payeeName" in rec`. And the
bulk handler sets a key only for a non-blank cell
(`if (val) record[targetField] = val`), while Zod emits only keys it saw. So
making `payeeName` optional meant a blank `PAYEE_NAML` produced a record with
**no `payeeName` key**, which validated, matched no route, and was discarded
with no counted reject.

All 3,811,692 rows / $2.11B that making the column nullable exists to admit
would have been lost — *less* visibly than the rejection they replaced, and
`FundingBasisNote` would then have stated affirmatively that no money lacks a
payee.

My own routing test missed it because it used `payeeName: ""`, a shape the
pipeline never produces. `ExpenditureSchema`'s object transform now restates
`payeeName` explicitly to guarantee the key, `finance-routing.ts` documents
that the two sides must change together, and the test builds the record by
**deleting** the key rather than blanking it.

### A seam between two individually-correct units published a false all-clear

`FundingBasisService` is injected `@Optional()`. Unwired — a provider dropped
in a refactor, or unresolved in one deployment unit — it returned the all-zero
basis with no throw and no log, and the frontend rendered that as "every
expenditure carries both a reported date and a reported payee": an affirmative
completeness claim about $11.87B that nobody measured, on an unauthenticated
page, cached for four hours. `measured: boolean` now separates "nothing is
missing" from "nobody looked", and it is the same reasoning the cache already
used.

### Gating the all-clear on `asOfSource` was the wrong axis

The first attempt hedged the all-clear whenever no source export was recorded.
But a `bulk_snapshots` row says nothing about which schema ingested the rows,
so once one existed the unhedged branch returned — in exactly today's
pre-resync state. Every claim is now **scoped to the records on file**, with an
explicit "not a guarantee that the source export held no others", and each
dimension gets its own sentence rather than one merged verdict.

### `unitemizedAmount: 0` was two different facts

It is what you get when every filing was reconciled and none hid money, and
what you get when the reconciliation pass has never run for that committee.
`reconciledFilings` now separates them; zero reports "none of these filings
has been checked" rather than claiming the good reading.

### `nulls: 'last'` silently cost 7,000x on a public page

Measured on the local 4,841,982-row table, not reasoned about:

| ordering | plan | time |
|---|---|---:|
| `date DESC, amount DESC` | Index Scan Backward | 0.147 ms |
| `date DESC NULLS LAST, …` (no new index) | Parallel Seq Scan + Sort | **1065 ms** |
| `… NULLS LAST, amount DESC, id` + new index | Index Scan | 0.191 ms |

A default B-tree is `(date ASC NULLS LAST)` — readable forward as
ASC NULLS LAST or backward as DESC NULLS FIRST. `DESC NULLS LAST` is neither,
so the existing index stopped serving the ordering entirely. Migration
`20261012233000_expenditure_null_aware_indexes` adds a matching partial index,
plus two partial indexes that make the disclosure aggregates **Index Only
Scans with zero heap fetches**, plus one for the snapshot lookup. `id` was
added as a unique tiebreaker: 5.2M rows will share `date = NULL`, and without
it offset pagination is not reproducible between queries.

The first migration's comment claiming the indexes "remain usable" is true for
`IS NULL` lookups and misleading for this ORDER BY. It is left as written —
an applied migration's checksum must not change — and corrected explicitly in
the second.

### A date could never transition back to NULL

`pick` builds the upsert with `Object.fromEntries`, which always sets the key,
so an absent field arrived as `undefined` — which Prisma reads as "leave
unchanged". Correct as a default, wrong for a restatement: CAL-ACCESS restates
whole schedules, so a filing that blanks `EXPN_DATE` would leave the
superseded date standing and the page would show a date the current filing
does not report. `clearableFields: ['date', 'payeeName']` writes explicit
`null` for those two columns only.

### The unitemized share mixed two populations on proposition pages

A side's `totalRaised` is committee contributions **plus** independent-
expenditure spending, while `unitemizedAmount` is a Schedule-A residual on
contributions alone. A side with $0 contributions and $5M of IEs would have
read "$100,000 of the $5,100,000 reported raised (2.0%)". The proposition
surface now passes no denominator and shows the exact dollars with no share;
the representative surface passes one because its totals are pure committee
aggregates.

### Smaller, same discipline

- A cached entry written between two revisions of this branch satisfied
  `!!parsed.basis` while leaving `measured` undefined — a non-nullable GraphQL
  field, failing every funding query for that id for the full TTL. Cache keys
  are **version-stamped** now, so a shape change is a miss by construction.
- `asOfSource` could date California figures to an FEC export: `dataType`
  `campaign_finance` is shared and `regionId` is not threaded here. It now
  answers only when the source is unambiguous, and reports unknown otherwise.
- `shareSuffix` could print "(1000.0%)" — `amount` is a signed decimal and
  CAL-ACCESS files negatives for refunds.
- The provenance date rendered a day early for every US reader; it is
  formatted in UTC now, unlike a meeting time.
- `coerceBlankableDate` accepted an `Invalid Date` instance, which the
  required path got for free from `z.date()`.
- `nulls: 'last'`, the null→undefined boundary mapping, the proposition
  stale-cache guard and its per-side date revival had **no tests** — each was
  fully reversible with the suite green. Six guards are mutation-verified.
- Three copies of `toNumber` and two of `reviveCached` collapsed into
  `finance-money.ts`. The revival rule had already drifted: one copy was
  tested, the other was not.
- Existing `Prisma.Decimal` test stubs exposed only `toNumber`, but the
  mapping uses `Number(amount)`, which goes through `toString` — so the
  fixtures yielded `NaN` and the assertions checked `typeof === 'number'`,
  which `NaN` satisfies. Replaced with real `Prisma.Decimal` and value
  assertions.
- `*.local.yml` is now gitignored: `docker-compose-uat.local.yml` says "NOT
  committed" in its own header and nothing enforced it, in a public repo.
- Query complexity raised 25 → 45 / 35 for the added round trips.

Deferred with a reason: `PropositionFundingSection` renders ten strings in
hardcoded English. Converting the two this change touched would leave the file
half-translated, and `pluralize(n, "committee")` needs real per-locale plural
keys. Filed as
[#1362](https://github.com/OpusPopuli/opuspopuli/issues/1362), the companion
to #1081.

## Post-merge correction: `unattributed` was overstated ~10x (2026-10-14)

Found the day after #1364 merged, while investigating the Schedule D
double-count. **A blank `payeeName` does not mean the recipient is unknown.**

Schedule D — "Summary of Expenditures Supporting/Opposing Other Candidates,
Measures and Committees" — records its recipient as a **candidate or a
measure**, so `PAYEE_NAML` is legitimately blank while `CAND_NAML` / `BAL_NAME`
state plainly who the money went to. Counting a blank payee alone told readers
*"names no payee in the filing … who received it was not reported"* about money
whose recipient the filing reports.

| | rows | dollars |
|---|---:|---:|
| as shipped (`payee_name IS NULL`) | 3,522,438 | **$1.516B** |
| recipient named in another column | 2,171,960 (61.7%) | — |
| truthful (no recipient anywhere) | 1,350,430 | **$0.152B** |

Per page it was far worse than the 10x platform ratio:

| page | as shipped | truthful |
|---|---:|---:|
| Buffy Wicks | $1,024,518 (200 rows) | **$11,800 (2 rows)** |
| Jesse Gabriel | $891,288 | $1,000 |
| Al Muratsuchi | $92,909 | $1,000 |

So the disclosure built to stop the site making unsupported claims was itself
making one, about named public figures' finances. 3,521,942 of the 3,522,438
no-payee rows are Schedule D, which is why this dominated the figure.

`FundingBasisService` now counts a row as unattributed only when **no
recipient is named anywhere** — `payeeName`, `candidateName` and
`propositionTitle` all null. The locale wording needed no change: it is simply
true now. Mutation-verified.

**`undated` is unaffected** — Schedule D has exactly 1 undated row, so that
figure is essentially pure Schedule E and stands as reported.

### What this says about the original work

The review caught me twice comparing populations that were not the same
population (raw vs deduplicated rows; `payeeName: ""` vs an absent key). This
is the same error a third time: `payee_name IS NULL` and "recipient unknown"
are different populations, and I treated them as one. The lesson that keeps
not sticking is to ask what a column *means* in the source before treating its
absence as a fact about the world — the schema comment on `scheduleCode` said
Schedule D was a memo schedule all along.

## Acceptance — recorded 2026-10-14

Resync ran 2026-10-13 14:49 → 2026-10-14 07:22: **14h59m** extract across 7/7
sources (42,158,073 items), then supersession, linking and reconciliation. No
errors.

| | before | after |
|---|---:|---:|
| `expenditures` rows | 4,843,241 | **12,992,920** (+168%) |
| undated rows / dollars | 0 / $0 | **4,592,786 / $5.506B** |
| unattributed rows / dollars | 0 / $0 | **3,522,438 / $1.516B** |
| rows missing both | 0 | 234 (archive predicted 292) |
| stored total | $37.797B | **$45.645B** |
| rows unattributed to a committee | — | **0** |

### What passed

1. **The 639,142-row residual closed.** Measured at the correct stage:
   pre-supersession `dated_and_attributed` was **5,520,808** against the
   predicted 5,523,263 — **0.04%**. Post-supersession it is 4,877,930, because
   #992 deletes superseded amendments and the prediction never modelled that.
   Both figures are right at their own stage; either quoted without its stage
   misleads.
2. **Zero `date` and zero `payeeName` rejects** in the #1361 tally, against
   9,044,935 rows before. Subtask 1's acceptance criterion, met in the live log.
3. **Cover-page linker: 8,159,423 / 8,159,423**, `noCoverPage=0`,
   `noCommittee=0`. Every admitted row is attributed, so every one is visible
   to `FundingBasisService`.
4. **The disclosure renders real figures.** Al Muratsuchi: $16,704,824 spent,
   of which **$11,898,949 (71.2%) across 4,127 payments has no reported date**.
   Jesse Gabriel: **89.6%**. Those rows did not previously exist.
5. **#992 held**: contributions over-itemization 524 / 175,110 = **0.30%**,
   matching its predicted 0.31%.

### What did NOT pass, and is not resolved

1. **96% of the admitted money is on committees with no page.**

   | committee bucket | undated rows | undated $ |
   |---|---:|---:|
   | unlinked to rep or measure | 4,522,062 | **$5.278B (95.9%)** |
   | measure-linked | 35,066 | $0.148B |
   | rep-linked | 35,658 | $0.081B |

   The rep and proposition pages are the only surfaces carrying the
   disclosure, so they describe **~$0.23B of $5.5B**. The data is right and
   the disclosure is right; the *reach* is a fraction of what the $11.87B
   headline implies. Only 70 of 434 rep-linked committees carry undated money,
   so most rep pages legitimately show an all-clear. **This needs its own
   decision** — a committee-level surface, or an explicit statewide total —
   and it is not what this issue delivered.

2. **4,505 filings itemize MORE expenditures than reported — diagnosed
   2026-10-14, and it is a SOURCE discrepancy this change revealed, not one it
   caused.**

   | hypothesis | test | result |
   |---|---|---|
   | the admitted rows duplicate existing ones | undated Schedule E rows on those filings having a dated twin (same payee + amount) | **0 of 258,785** |
   | reconciliation compares mismatched amendments (#992 item 1) | `filing_reconciliations.amend_id` vs `max(amend_id)` of the detail | **4,423 of 4,505 match**; 82 mismatch |

   Neither duplication nor version skew. The undated rows admitted here are
   87.9% of the Schedule E detail on those filings ($1,565.68M vs $215.69M
   dated) and the excess over reported line 6 is **$361.25M across 2.57% of
   filings** — i.e. those filers itemized more on Schedule E than they
   reported on the summary line. Invisible while 56% of Schedule E was being
   rejected.

   So this belongs to this issue's own principle — *say when we are not
   certain due to missing and/or conflicting data* — as a **disclosure**
   question, not a pipeline bug. `FilingReconciliationService`'s warning text
   ("detail exceeding the source is a fault, not a source quirk") may need
   revisiting now that the population it was written to catch is measurable.

   I had asserted on #1367 that Schedule D memo double-counting explained
   this. It does not: reconciliation already filters to `E`
   (`EXPENDITURE_SCHEDULE = 'E'`, applied in `detail_e`). Retracted there.

3. **`asOfSource` is still null.** The run used the container built before the
   `last_modified` capture fix, so the figures cannot be dated to an export.
   The backfill corrects the existing row on the next finance sync — unverified
   until then.

### Dollar targets: the comparison I set up wrong

The $9.75B / $2.11B targets were sums over **raw** `EXPN_CD` rows; the store
holds **distinct keys with superseded amendments deleted**. Supersession
removed 1,107,527 expenditure rows (15,764 filings) and 2,832,297 contribution
rows (10,928 filings), so the stored figure moves *away* from the raw sum by
design — the raw total counts the same money once per amendment, which is the
double-count #992 exists to remove. I called these targets "the strong ones
because they came off the raw TSV"; that was the error, and it is the same
mistake the code review caught twice — comparing two populations that are not
the same population. Settling it properly needs a distinct-key, max-`AMEND_ID`
dollar sum over the archive, which was not computed.

## Risks

| | likelihood | mitigation |
|---|---|---|
| Date-filtered views break on null dates | **unscoped** | Not yet checked what the frontend does with a null expenditure date. Scope before subtask 1 — if time-series views are load-bearing, that work may exceed the ingest change |
| Totals move with no explanation | high if split | Subtasks 1 and 2 ship together, by decision above |
| Disclosure becomes boilerplate | medium | Rule 2 above: name the quantity. A caveat nobody can act on is decoration |
| Resync cost | known | ~4h per #992's estimate; shares Ollama with nothing, but see #1037 (no watermark, no resume) |

## Scoping result — open question 1, answered 2026-10-12

Four consequences, found by reading rather than assumed. Each is now part of
subtask 1 rather than a risk:

1. **GraphQL declares `date!: Date` non-null** (`expenditure.model.ts:45`).
   Making the column nullable without changing this errors the ENTIRE query for
   any undated row, not just that field. `payeeName` is the same. This is a
   federated subgraph change, so the API Gateway must validate it (CLAUDE.md).
2. **`orderBy: [{ date: 'desc' }, { amount: 'desc' }]`**
   (`region-query.service.ts:1360`). Postgres sorts `NULLS FIRST` on `DESC`, so
   5.2M undated rows would land at the TOP of every expenditure listing — page
   one would be entirely undated. Needs `{ date: { sort: 'desc', nulls: 'last' } }`.
3. **`formatDate(null)` renders "Jan 1, 1970"** — `new Date(null)` is the epoch
   (`apps/frontend/lib/format.ts:56`). A fabricated date is strictly worse than
   a blank, and worse than the omission we are fixing. The display must branch.
4. **No date-range *filter* exists** on the expenditure list — only ordering and
   display. So nothing silently excludes undated rows; they appear or they do
   not.

## Open questions
2. Should an undated expenditure be excluded from time-series views while
   remaining in the total? Probably yes, but it means the two figures disagree
   on purpose, which itself needs saying.
3. ~~`AMOUNT` blank on 51,266 rows becomes `0` via `z.coerce.number()`~~ —
   **corrected 2026-10-14: they are REJECTED** (`Expected number, received
   nan`, 51,266 of them, measured on the live run). See the Problem section.

   The scoping decision stands — `amount` stays required, and no fabricated
   `$0` rows enter the totals, which is a better outcome than this plan
   claimed. But the disposition is now a real choice rather than a
   non-issue: 51,266 rows are dropped, and under this issue's own
   admit-and-disclose principle "the filer reported a payment and no amount"
   is a disclosable fact, not a row to discard silently. It changes no dollar
   total either way. Out of scope here; worth its own issue.

   Old text, kept because the reasoning was wrong and the record should show
   it: "Harmless
   for totals, but a $0 expenditure row is its own small untruth. Out of scope;
   worth its own look.
