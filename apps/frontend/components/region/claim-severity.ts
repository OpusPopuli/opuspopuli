import type { ClaimSeverity } from "@/lib/graphql/region";

/**
 * Shared severity → Tailwind colour ramp for minutes claim badges (#932),
 * mirroring the fiscal-level ramp on the bill page (green → amber → red).
 * Single source of truth for both `ClaimSeverityTag` and `ConcernsBadge`.
 */
export const SEVERITY_STYLES: Record<ClaimSeverity, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  HIGH: "bg-red-100 text-red-800",
};
