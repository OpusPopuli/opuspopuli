# Plan: settings shell responsiveness — verify and unskip

| | |
|---|---|
| **Issue** | [#766](https://github.com/OpusPopuli/opuspopuli/issues/766) — fix(frontend): make SettingsShellLayout responsive |
| **Date** | 2026-08-30 |
| **Author** | Rodney Gagnon |
| **Branch** | `fix/settings-shell-responsive-766` |
| **Data classification** | **No new exposure.** `us-state-privacy` + `soc2` active per `.claude/compliance-profile.yaml`. `/me/profile` renders CCPA personal information, but this is layout and test work: no new data flow, no new logging, nothing sent to a model. E2E seeds synthetic profiles via `seedProfile`. |
| **Migrations** | None. |
| **Federation** | None. |
| **Dependencies** | None new. No AGPL-3.0 conflict. |

## The issue is already fixed. This is the part nobody went back to.

`9cd55d3e fix(frontend): make the settings shell usable on a phone` is on `main`
and does what #766 asks:

```jsx
<div className="flex flex-col lg:flex-row gap-8">
  <nav className="w-full lg:w-64 lg:flex-shrink-0">
```

Its own comment records that it was caught by mobile-safari e2e after #1069
moved My Scans into the shell — so it was fixed as a **side effect of unrelated
work**, and #766 was never closed. The issue's three suggested approaches (pill
row, hamburger drawer, native select) are moot: the nav is already full-width
stacked below `lg`, by none of them.

Confirmed visually on a real iPhone, 2026-08-30.

## What is actually left

Four tests in `apps/frontend/e2e/profile.spec.ts` are still skipped on both
mobile projects, citing #766. The skip describes a failure that is **not the
sidebar**:

> the modal dialog overlay + the no-fields toggle target end up overlapped by
> the layout's outer scroll region

Whether the stacking fix cured that has never been checked. Rendering correctly
and being clickable are different claims, and only the first has been confirmed
— by eye, which is exactly the evidence that cannot settle pointer
interception.

## Subtasks

### 1. Gate — find out what, if anything, still fails
**App:** `apps/frontend`. No source changes.

Remove `skipOnMobile` locally, run all four tests on `mobile-chrome` (Pixel 5 /
chromium) and `mobile-safari` (iPhone 12 / webkit). Both browsers are installed
locally. Capture the intercepting element from the trace rather than inferring
it.

Local run needs `next dev --port 3201` and `BASE_URL`: Tempo holds 3200 while
the observability stack is up.

**Outcome:** either "nothing remains, delete the skip" or a named element and
a real bug to fix. Everything below branches on this.

**Result, 2026-08-30: 7 of 8 passed.** The sidebar was not implicated in any
failure. The single failure was `mobile-safari` only:

```
edit a multi-select-chips field → save → see persisted chips
Error: locator.check: Clicking the checkbox did not change its state
  locator resolved to <input class="sr-only" type="checkbox"/>
  - forcing action ... click action done
```

Not a layout bug and not a product bug. `inputs.tsx` wraps the `sr-only`
checkbox in its `<label>`, so the association is correct and a thumb tapping
the chip toggles it — which is why the page works on a real iPhone. The *test*
reached past the chip to force-click the hidden 1px input; Chromium tolerates
that and WebKit does not.

### 2. Conditional — fix the residual — **DONE, and it was the test**
No source change was needed. The test now clicks the chip instead of the hidden
input:

```ts
await interestsRow.locator("label", { hasText: /healthcare/i }).click();
```

That is also what a user does, so the test got more truthful rather than more
lenient. Verified across `chromium`, `mobile-chrome` and `mobile-safari`.

Worth recording plainly: **the skip blamed a layout bug for a test bug, and
outlived the layout fix by three months.** The comment asserted the overlay was
"overlapped by the layout'"'"'s outer scroll region" — nobody had re-checked that
claim after `9cd55d3e`, and it was never true of this failure.

### 3. Unskip, and clear the stale references
- Delete `skipOnMobile` and its comment block (`profile.spec.ts:296-309`)
- Drop the now-false #766 note at `briefing.spec.ts:21`

### 4. Accessibility sweep at mobile widths
`pnpm test:a11y`, plus axe assertions across `/settings/*` and `/me/profile` at
a mobile viewport. The shell is shared by every settings page, so a change here
is a regression surface for all of them. WCAG 2.2 AA is a repo gate.

### 5. Close #766 with what was actually true
Record that the layout fix landed in `9cd55d3e`, that this branch verified the
interaction contract, and that the issue's suggested approaches were overtaken.
Otherwise the next reader rebuilds a nav that does not need rebuilding.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Tests fail for a cause unrelated to the sidebar | medium × possible | Subtask 1 is a gate; re-scope before writing a fix |
| Shared-shell change regresses other `/settings/*` pages | medium × possible | Subtask 4 sweeps every page in the shell |
| Unskipping adds 4 tests × 2 mobile projects to CI shards | low × likely | Accepted; coverage is the point |
| WCAG 2.2 AA regression at mobile widths | medium × possible | `pnpm test:a11y` gate before the PR |
| Local e2e cannot bind 3200 (Tempo) | low × likely | `--port 3201` + `BASE_URL` |
| Issue text misleads the next reader | low × likely | Subtask 5 records the real history on the issue |

## Effort

| | |
|---|---|
| Subtask 1 | ~20 minutes |
| Subtasks 3–5 | half a day |
| Subtask 2 | 0 if the gate is green; up to a day if a real overlay bug remains |

## Out of scope

- Redesigning the settings nav (pill row, hamburger, select) — the shell already stacks
- Any `/settings/*` page's own content layout
