# `components/briefing/` — Your Civic Briefing home page

Implements `/me/briefing` from issue #744: the post-auth landing page
that personalizes the four civic-data surfaces (bills, reps,
committees, propositions) using the user's `SignalProfile` +
`RankingFlags` from the `users` service and the relevance scoring in
the `knowledge` service.

In v1.0 only the **bills** section is fully personalized — the other
three sections render placeholder cards that link back to the
non-personalized `/region/*` surfaces. Their personalization layers
are tracked in follow-up issues #769 (reps), #770 (committees), and
#771 (propositions).

## Composition pattern

The page is a domain-agnostic **shell + N sections** composer:

```
BriefingPage
├── BriefingPageHeader            ("Your Civic Briefing" + Browse all civic data →)
├── BriefingSection slug="bills"  ← BillsBriefingSection (real)
├── BriefingSection slug="reps"   ← RepsBriefingPlaceholder
├── BriefingSection slug="committees"
│                                 ← CommitteesBriefingPlaceholder
└── BriefingSection slug="propositions"
                                  ← PropositionsBriefingPlaceholder
```

`BriefingSection` is the unit of composition. It owns the section
chrome (title, subtitle, optional icon, "See all →" link) and
exposes `data-section={slug}` for e2e selectors. When #769/#770/#771
ship, each replaces its placeholder body with a real
`<XBriefingSection />` component matching the bills pattern — no
changes to the shell.

## Where the data comes from

The bills section orchestrates a **three-step GraphQL fetch chain**
(see `bills/useBillBriefing.ts`):

1. `myRankingFlags` + `mySignalProfile { interestTags }` — the 20
   boolean derivations and declared topics, from the `users` service.
2. `myPersonalizedBillFeed(input, limit)` — the ranked `[billId,
relevanceScore, axisScores]` list, from the `knowledge` service.
   The frontend passes step-1's output as input here per the v1.0
   federation boundary (planning doc §6.3).
3. `bill(id)` × N — the bill detail records, from the `region`
   service, fanned out in an effect once the feed resolves.

The two-service boundary (knowledge needs flags + tags) is a v1.0
shape that #761 will collapse into a subgraph-to-subgraph call. The
frontend will then only see the ranked feed.

### Apollo `__typename` gotcha

Apollo Client auto-decorates fetched objects with `__typename`. When
the step-1 `RankingFlags` object is passed back as the
`RankingFlagsInputDto` argument in step 2, the InputType validator
rejects the extra field. The hook strips it via `stripTypename()`
(`lib/graphql/personalized-feed.ts`) before constructing the input.
There is a regression test in
`__tests__/lib/graphql/personalized-feed.test.ts`.

## Two paradigms across `/me/*` — when to use which

### Settings shell (`/settings/*`, `/me/profile`)

Sidebar + content area, single-form-per-tab. Used for
**configuration** — places where the user is changing their own
state. The sidebar lives at module scope and persists across tabs.

### Briefing shell (`/me/briefing`)

Header + Footer + page body, no sidebar. Used for
**consumption** — places where the user is reading information the
platform produced. Matches the `/region/*` chrome so the cross-link
between Briefing and Region feels like one surface.

Both reuse `ProtectedRoute` for auth-gating. The auth check lives in
the route's `layout.tsx`, not the page, so the page can be a pure
composition function.

## Key files

| File                                               | Purpose                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BriefingPage.tsx`                                 | Top-level composer; renders header + 4 sections                                                                                                                                                                           |
| `BriefingPageHeader.tsx`                           | Page H1 + "Browse all civic data →" linkout to `/region`                                                                                                                                                                  |
| `BriefingSection.tsx`                              | Domain-agnostic section shell (slug, title, subtitle, icon, seeAllHref)                                                                                                                                                   |
| `bills/BillsBriefingSection.tsx`                   | Bills section orchestrator — owns hero + compact list + empty / noProfile / error states                                                                                                                                  |
| `bills/useBillBriefing.ts`                         | The three-step fetch hook; returns `BillBriefingState`                                                                                                                                                                    |
| `bills/BillBriefingHero.tsx`                       | Featured top card; renders the highest-ranked bill                                                                                                                                                                        |
| `bills/BillBriefingCard.tsx`                       | Compact card for ranks 2–N                                                                                                                                                                                                |
| `bills/RelevanceChip.tsx`                          | 3-tier relevance badge (≥70 / ≥40 / <40)                                                                                                                                                                                  |
| `bills/WhyThisPanel.tsx`                           | Collapsible per-card disclosure. Renders the LLM-written `relevanceExplanation` from #745 when present; falls back to the top-axis heuristic explanation when null (LLM not yet computed, failed, or validator-rejected). |
| `bills/BillsTopicFilter.tsx`                       | Read-only chips of `interestTags` + "Edit your interests →" linkout to `/me/profile`                                                                                                                                      |
| `placeholders/PlaceholderBody.tsx`                 | Shared placeholder card layout                                                                                                                                                                                            |
| `placeholders/RepsBriefingPlaceholder.tsx`         | Reps placeholder; references #769                                                                                                                                                                                         |
| `placeholders/CommitteesBriefingPlaceholder.tsx`   | Committees placeholder; references #770                                                                                                                                                                                   |
| `placeholders/PropositionsBriefingPlaceholder.tsx` | Propositions placeholder; references #771                                                                                                                                                                                 |

## i18n

All copy lives in `locales/{en,es}/briefing.json` under the
`briefing` namespace. Sections, placeholder bodies, the "why this"
axis explanations, and the empty/loading/no-profile states are all
keyed there. Add the namespace once in `lib/i18n/index.ts`.

## Where each follow-up plugs in

| Issue | What it replaces                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #745  | **shipped** — LLM-written sentence renders in `WhyThisPanel` when `relevanceExplanation` is present on the feed result; heuristic stays as the fallback for bills the nightly batch hasn't computed yet |
| #761  | `useBillBriefing`'s three-step chain → single `myPersonalizedBillFeed` query that already includes bill details                                                                                         |
| #769  | `RepsBriefingPlaceholder` → real `RepsBriefingSection`                                                                                                                                                  |
| #770  | `CommitteesBriefingPlaceholder` → real `CommitteesBriefingSection`                                                                                                                                      |
| #771  | `PropositionsBriefingPlaceholder` → real `PropositionsBriefingSection`                                                                                                                                  |

Each follow-up should match the bills pattern: a `<XBriefingSection>`
hosted inside `<BriefingSection slug="x">` with its own
`use<X>Briefing` hook. The shell stays untouched.

## Testing

- Unit tests for shell + helpers live in
  `__tests__/components/briefing/` and
  `__tests__/lib/graphql/personalized-feed.test.ts` (including the
  `__typename` strip regression).
- E2E coverage in `e2e/briefing.spec.ts`: render, header / footer
  chrome, all four "See all" linkouts, the "Browse all civic data →"
  link, the unauthenticated → `/login` redirect, mobile render, and a
  WCAG 2.2 AA axe scan. The Header desktop nav assertions skip on
  `mobile-chrome` / `mobile-safari` because Header uses
  `hidden md:flex` — the mobile menu is covered by `Header.test.tsx`.
