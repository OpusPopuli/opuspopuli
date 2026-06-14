import type { TFunction } from "i18next";
import type { ContributingSignal } from "@/lib/graphql/personalized-feed";

/**
 * Map a `ContributingSignal` to the i18n key that renders it as
 * citizen-readable copy (#750). Centralized here (not inlined in the
 * panel) so:
 *   - the per-flag and per-action-tier vocabulary lives in one place
 *     and adding a new RankingFlag only requires one i18n addition;
 *   - the panel stays a pure render component without taxonomy logic;
 *   - the fallback rule (unknown key → raw slug) is consistent so a
 *     per-region interest taxonomy that hasn't been translated yet
 *     still surfaces something readable rather than blanking out.
 *
 * Convention for the i18n keys (under the `briefing` namespace):
 *   - `whyThis.signals.sensitiveFlag` — neutral label for ANY FLAG
 *     signal where `isSensitive` is true. Per issue #750 AC, T3-
 *     derived signals must not name the specific trait until "show me
 *     why" mode ships (post-MVP). This single key handles every T3
 *     flag, so the panel never surfaces which sensitive identity
 *     produced the recommendation.
 *   - `whyThis.signals.flag.<flagKey>` for non-sensitive FLAG signals
 *   - `whyThis.signals.actionability.<bucketKey>` for ACTIONABILITY
 *   - INTEREST_TAG signals never use i18n — the slug itself is the
 *     label because per-region interest taxonomies are open-set.
 */
export function signalLabel(signal: ContributingSignal, t: TFunction): string {
  if (signal.type === "flag") {
    // Sensitive (T3-derived) flags collapse to a single neutral label
    // so the panel never names which T3 trait produced the match.
    if (signal.isSensitive) {
      return t("whyThis.signals.sensitiveFlag");
    }
    const key = `whyThis.signals.flag.${signal.key}`;
    const translated = t(key);
    // i18next returns the key unchanged when no translation matches;
    // fall back to a readable form of the slug in that case.
    return translated === key ? humanizeSlug(signal.key) : translated;
  }
  if (signal.type === "actionability") {
    const key = `whyThis.signals.actionability.${signal.key}`;
    const translated = t(key);
    return translated === key ? humanizeSlug(signal.key) : translated;
  }
  // INTEREST_TAG: the slug IS the label so per-region taxonomies stay
  // open-set without forcing every tag through i18n.
  return humanizeSlug(signal.key);
}

/**
 * Format a slug into a readable label as a last-resort fallback.
 * `isRenter` -> "Is renter", `within_30_days` -> "Within 30 days".
 * Intentionally generic — only fires when the i18n catalog hasn't
 * been updated for a new signal.
 */
function humanizeSlug(slug: string): string {
  const spaced = slug
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
