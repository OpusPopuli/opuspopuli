"use client";

import type { PropositionAnalysisClaim } from "@/lib/graphql/region";

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
  if (claims.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 ml-1 align-baseline">
      {claims.map((claim, idx) => (
        <button
          key={`${claim.sourceStart}-${claim.sourceEnd}-${idx}`}
          type="button"
          onClick={() => onNavigateToSource(claim)}
          title={`See source passage (chars ${claim.sourceStart}–${claim.sourceEnd})`}
          className="inline-flex items-center justify-center min-w-[1.25rem] h-[1.25rem] px-1 text-[10px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
        >
          {idx + 1}
        </button>
      ))}
    </span>
  );
}
