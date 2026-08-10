import type { ClaimSeverity } from "@/lib/graphql/region";

/**
 * Shared severity → Tailwind colour ramp for minutes claim badges (#932),
 * mirroring the fiscal-level ramp on the bill page (green → amber → red).
 * Single source of truth for both `ClaimSeverityTag` and `ConcernsBadge`.
 */
export const SEVERITY_STYLES: Record<ClaimSeverity, string> = {
  LOW: "bg-positive-surface text-positive",
  MEDIUM: "bg-warning-surface text-warning",
  HIGH: "bg-danger-surface text-danger",
};
