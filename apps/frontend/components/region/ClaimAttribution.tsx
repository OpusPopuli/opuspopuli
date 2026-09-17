"use client";

import { useTranslation } from "react-i18next";

import type { PropositionAnalysisClaim } from "@/lib/graphql/region";

/** Longest quote shown in a tooltip before truncation. */
const TOOLTIP_QUOTE_CHARS = 160;

/**
 * Anchor id used by SegmentedFullText to mark the range a claim cites.
 * Kept as an exported helper so both this component and the target can
 * agree on the same id scheme without a shared context.
 */
export function claimAnchorId(
  claim: Pick<PropositionAnalysisClaim, "sourceStart" | "sourceEnd">,
): string {
  return `prop-claim-${claim.sourceStart}-${claim.sourceEnd}`;
}

/**
 * Accessible name for a citation marker.
 *
 * Shows the reader what was actually cited. Under the quote-then-locate
 * contract (#1212) the passage itself is stored, and it is far more use than
 * the character offsets this previously exposed — "chars 1432–1587" is not
 * something a voter can check anything against, and those offsets were
 * correct about 2% of the time. Falls back to a generic label for analyses
 * generated before the cutover, which carry no quote.
 */
function useClaimLabel(): (claim: PropositionAnalysisClaim) => string {
  const { t } = useTranslation("region");
  return (claim) => {
    const quote = claim.sourceQuote;
    if (!quote) return t("claims.seeSourcePassage");
    return t("claims.seeSourceQuote", {
      quote:
        quote.length > TOOLTIP_QUOTE_CHARS
          ? `${quote.slice(0, TOOLTIP_QUOTE_CHARS)}…`
          : quote,
    });
  };
}

/**
 * Inline footnote-style marker rendered next to an AI-derived analysis
 * string (e.g., a key provision bullet). Clicking it switches the page
 * to the Deep Dive layer, scrolls to the cited passage, and highlights
 * it so the reader can verify the claim against the source text.
 */
export function ClaimAttribution({
  claims,
  onNavigateToSource,
}: {
  readonly claims: PropositionAnalysisClaim[];
  readonly onNavigateToSource: (claim: PropositionAnalysisClaim) => void;
}) {
  const label = useClaimLabel();

  if (claims.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 ml-1 align-baseline">
      {claims.map((claim, idx) => (
        <button
          key={`${claim.sourceStart}-${claim.sourceEnd}-${idx}`}
          type="button"
          onClick={() => onNavigateToSource(claim)}
          title={label(claim)}
          aria-label={label(claim)}
          className="inline-flex items-center justify-center min-w-[1.25rem] h-[1.25rem] px-1 text-[10px] font-bold rounded-full bg-info-surface text-info border border-info-line hover:bg-info-line transition-colors"
        >
          {idx + 1}
        </button>
      ))}
    </span>
  );
}
