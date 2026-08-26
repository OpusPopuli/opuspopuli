# Plan: Move My Scans into the Settings shell

| | |
|---|---|
| **Issue** | [#1069](https://github.com/OpusPopuli/opuspopuli/issues/1069) |
| **Date** | 2026-08-26 |
| **Author** | Rodney Gagnon (plan drafted by Claude, approved by Rodney) |
| **Data classification** | **CCPA/CPRA personal information (`ca-personal-information`). No new regulated-data flows.** Active families per `.claude/compliance-profile.yaml`: `us-state-privacy`, `soc2`. `hipaa` inert — this repo holds no PHI. Change is presentation-only: no change to storage, retention, redaction, logging, prompts or fixtures, and nothing new is sent to a model. Per-user access control verified, not assumed (see below). |
| **Migrations** | **None.** No schema, no resolver, no GraphQL/federation change. No new dependencies (AGPL-safe). |
| **Branch** | `feat/scans-in-settings-1069` |
| **Effort** | ~5 focused sessions (1.5–2 days) |
| **Status** | Approved 2026-08-26. |

## One line

Move the scans list and scan detail out of the pinned-dark camera shell into
Settings, and retokenize the shared analysis components once so both surfaces
can use them.

## Context (traced 2026-08-26, recorded in #1069)

Only signed-in users can scan, and the way people actually reach their scans is
the Settings sidebar. That link sends them out of Settings into `/petition/*`,
which `app/petition/layout.tsx` renders as `fixed inset-0 bg-black on-fixed-dark`
— the camera viewfinder scope, deliberately pinned dark in both themes because a
live video feed is black in both themes.

That scope is right for the camera and wrong for a records list. The sidebar
disappears, the page leaves document flow (no app header, no footer, no
`max-w-7xl` column), and a light-theme user goes from warm paper to full black in
one click.

This **supersedes the approach taken in PR #1061** (`14a1729d`, merged
2026-08-24), items 3 and 4, which committed to bordered dark cards on the
petition surface and added `?from=settings` to soften the one-way door. Rather
than making the camera shell a better host for this list, move the list to the
shell that already fits it. `app/settings/activity/page.tsx` is the same shape —
filtered, paginated, deletable, with summary tiles — and is the styling
reference.

PR #1061 was never backed by an issue ("no issues filed per reporter
preference"), so #1069 is the first tracked record of that design direction and
its reversal.

One live regression from PR #1061 item 4 is folded in here: `isActive` in
`SettingsShellLayout.tsx` compares against `pathname`, which never carries a
query string, so `pathname.startsWith("/petition/history?from=settings")` is
never true. My Scans is the only nav item that can never render active. Dropping
the query string fixes it; `isActive` itself needs no change.

Not launch-blocking — we are already launched. This is polish intended to
support a blog post, so the visual result needs to hold up in screenshots.

## Decisions taken

1. **Scan detail follows into Settings.** The scanner itself is a later refactor.
2. **ScanFab and the petition-home link land in Settings** — no duplicate list.
3. **Not launch-blocking**; polish to support a blog post.
4. **Delete dialogs use `.on-ink`**, not `bg-ink`. On the Settings surface an
   opaque ink panel sits on paper, inverting its relationship to the page;
   `.on-ink` flips to a paper panel in dark theme so the dialog reads as
   *elevated* in both themes rather than *dark*. Recommended and unchallenged at
   approval — cheap to flip to plain `bg-surface` + `border-line` if it reads
   flat in review.

## Subtasks

### 1. Retokenize the shared petition components — own commit, no route changes

**Files:** `components/petition/{AnalysisDisplay,PersonalizedImpact,NotAPetition,TrackOnBallotButton}.tsx`,
`components/ReportIssueButton.tsx`

`text-paper` → `text-content`, `border-paper/25` → `border-line`,
`bg-paper/10|15` → `bg-surface-alt`. `bg-ink` stays only on true overlays, per PR
#1061 item 3.

This is close to a no-op on the camera surface because `.on-fixed-dark` already
remaps exactly these roles:

| pinned class | semantic token | resolves to under `.on-fixed-dark` |
|---|---|---|
| `text-paper` | `text-content` | `--color-paper` |
| `border-paper/25` | `border-line` | `paper` @ 20% |
| `bg-paper/10`, `bg-paper/15` | `bg-surface-alt` | `paper` @ 12% |

It lands **first and alone** precisely because `/petition/results` shares these
components and must not move. One diff to verify visually, then routes move in a
diff that cannot have caused a visual regression.

**Tests:** `e2e/design-tokens.spec.ts` green; before/after screenshot of
`/petition/results`; `pnpm test:a11y` 60/60 held.

### 2. `/settings/scans` — the list

**Files:** `app/settings/scans/page.tsx` (new)

Port `app/petition/history/page.tsx` restyled against
`app/settings/activity/page.tsx`: title block, summary tiles, one card with
`divide-y divide-line` rows, `border-line` toolbar inputs, delete-all in its own
panel.

**No `layout.tsx`** — `app/settings/layout.tsx` already wraps all of
`/settings/*` with `SettingsShellLayout`. (`/me/*` needs its own only because it
sits outside that segment.)

Drop the toolbar "Scan a Petition" button — `OVERLAY_HIDDEN_PREFIXES` hides
ScanFab on `/petition` but not `/settings`, so the FAB now renders here and a
second button would duplicate it. Keep a CTA in the empty state, where the FAB
alone is weak guidance.

Queries, mutations, 300 ms debounce and `PAGE_SIZE = 10` carry over unchanged:
`GET_MY_SCAN_HISTORY`, `SOFT_DELETE_SCAN`, `DELETE_ALL_MY_SCANS`.

### 3. `/settings/scans/[id]` — the detail

**Files:** `app/settings/scans/[id]/page.tsx` (new)

Same port, using `GET_SCAN_DETAIL` and `GET_LINKED_PROPOSITIONS`. All
`fromParam` threading deleted — back is unconditionally `/settings/scans`. Body
renders the subtask-1 components, now correctly themed. The bare `confirm()` for
delete is replaced with the panel dialog treatment for consistency with the list.

### 4. Nav, inbound links, redirects

**Files:** `components/settings/SettingsShellLayout.tsx`, `app/petition/page.tsx`,
`app/petition/history/page.tsx` + `app/petition/history/[id]/page.tsx` (→ `redirect()`)

Nav href → `/settings/scans`, query string gone — which is what fixes
`isActive`. Petition-home `t("home.myScans")` retargeted. Old routes redirect
rather than 404: shared links and the cached PWA shell still point at them.

### 5. i18n

**Files:** `locales/{en,es}/settings.json`, `locales/{en,es}/petition.json`

Move `petition:history.*` → `settings:scans.*`. New keys for the summary tiles
and the delete-all panel. Leave `petition:results.*` alone — the results page
still uses it. Spanish lands in the same PR.

### 6. Tests

`__tests__/pages/petition/{history,scan-detail}.test.tsx` →
`__tests__/pages/settings/`; `e2e/petition-history.spec.ts` retargeted (8
`page.goto` calls); `e2e/settings.spec.ts` gains the **nav-active assertion** —
the regression that had no test; new a11y coverage for the panel.

## Data classification detail

Petition sheets can carry signer names and addresses, so scan documents and
their OCR text are California personal information under the declared
`us-state-privacy` family.

Access control **verified rather than assumed**, since the route move is a good
moment to check for IDOR:

- `scan-history.service.ts:100` — `findFirst({ where: { id: documentId, userId, deletedAt: null } })`.
  Ownership is scoped at the service layer. No IDOR; no action needed.
- `ProtectedRoute` gating carries over via `app/settings/layout.tsx`, which
  already wraps `/settings/*`.

One rule for the work: summary text in the new list rows comes from
`item.summary`, which can echo document content. Do not add debug logging of row
data, and keep blog-post screenshots to a seeded fixture account — never a real
one.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Retokenization visually regresses `/petition/results` | medium × possible | Subtask 1 ships alone; `e2e/design-tokens.spec.ts` + before/after screenshot before any route moves |
| Contrast regression on the new light surface | medium × possible | `pnpm test:a11y` gate; status pills use full semantic tuples, never a partial override (the 1.78:1 badge precedent in `globals.css`) |
| Cached PWA shell holds stale `/petition/history` routes | low × likely | Redirects retained indefinitely, not deleted along with the pages |
| ScanFab overlaps the delete-all panel at mobile width | low × possible | Verify at 375 px; add bottom padding if it collides |
| i18n key move leaves untranslated strings | medium × possible | Spanish in the same PR; grep for orphaned `history.*` references before merge |
| Blog-post screenshots leak real signer PII | **high × possible** | Seeded fixture account only; explicit acceptance criterion on the issue |
| Scope creep into the scanner refactor | low × likely | Explicitly deferred by decision 1 — camera flow untouched |

## Out of scope

- The scanner/camera refactor (deferred by decision 1).
- `/petition/results` behavior — it stays in the camera shell and must be
  visually unchanged.
- `app/settings/email-history/page.tsx`, which is not in the nav and has a
  hardcoded English `<h1>`. Worth its own chore issue; not this one.
