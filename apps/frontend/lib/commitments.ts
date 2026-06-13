/**
 * Public ethical commitments — versioned source of truth (#754).
 *
 * The ten commitments themselves are the §10 content of the planning
 * doc (`docs/architecture/personalized-relevance.md`) — copied here
 * verbatim as keyed i18n entries (`locales/<lng>/commitments.json`)
 * so they render in English and Spanish.
 *
 * The slugs in `COMMITMENT_SLUGS` are the cross-language stable
 * identifiers — used as the i18n key (`commitments.<slug>.title|body`),
 * the anchor on the page (`#<slug>`), and the value the backend
 * acknowledge mutation can reference if it ever needs to point at a
 * specific commitment a user has not yet acknowledged.
 *
 * Version bumping rule (per commitment 7 of the doc — "we will not
 * silently change the rules"): a material change to any commitment
 * requires bumping `COMMITMENTS_VERSION` (in `commitments-version.json`),
 * appending an entry to `COMMITMENTS_HISTORY`, and re-prompting all
 * signed-in users to re-acknowledge — the User row tracks
 * `commitmentsVersionAcknowledged` so the onboarding step can
 * re-trigger on version drift.
 */

import commitmentsVersionFile from "./commitments-version.json";

/** Stable slugs for the ten commitments. Order matches §10 of the planning doc. */
export const COMMITMENT_SLUGS = [
  "youOwnYou",
  "askForLess",
  "neverSellData",
  "neverTargetPolitically",
  "tellYouWhy",
  "showOtherSide",
  "notSilentlyChange",
  "notRequireLegibility",
  "publicMission",
  "discloseFailure",
] as const;

export type CommitmentSlug = (typeof COMMITMENT_SLUGS)[number];

/**
 * Current published version. Bump in `commitments-version.json` when
 * any commitment's wording changes materially (typos and translation
 * fixes don't count). Format: semver-ish `MAJOR.MINOR.PATCH` — MAJOR
 * is incremented when a commitment is added/removed/inverted, MINOR
 * for substantive rewording, PATCH for clarifications that don't
 * change the meaning.
 *
 * The PDF generator script (`scripts/generate-commitments-pdf.mjs`)
 * reads the same JSON file directly so its output filename stays
 * in lockstep with what's shown on the page.
 */
export const COMMITMENTS_VERSION = commitmentsVersionFile.version;

/** ISO YYYY-MM-DD of the most recent change. */
export const COMMITMENTS_LAST_UPDATED = commitmentsVersionFile.lastUpdated;

export interface CommitmentHistoryEntry {
  readonly version: string;
  readonly date: string;
  /** i18n key under `commitments:history.<key>` for the human-readable summary. */
  readonly summaryKey: string;
}

/**
 * Public version history. Newest first. The git log is the legal
 * audit trail (per the issue's "Version control" acceptance criterion)
 * — this list is the human-readable summary for the public page.
 */
export const COMMITMENTS_HISTORY: ReadonlyArray<CommitmentHistoryEntry> = [
  {
    version: "1.0.0",
    date: "2026-06-13",
    summaryKey: "v1_0_0",
  },
];
