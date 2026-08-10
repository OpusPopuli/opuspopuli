"use client";

import type { PropositionStatus } from "@/lib/graphql/region";

const STATUS_STYLES: Record<
  PropositionStatus,
  { bg: string; text: string; label: string }
> = {
  PENDING: { bg: "bg-warning-surface", text: "text-warning", label: "Pending" },
  PASSED: { bg: "bg-positive-surface", text: "text-positive", label: "Passed" },
  FAILED: { bg: "bg-danger-surface", text: "text-danger", label: "Failed" },
  WITHDRAWN: { bg: "bg-surface-alt", text: "text-content", label: "Withdrawn" },
};

interface PropositionStatusBadgeProps {
  readonly status: PropositionStatus;
}

/**
 * Badge showing the status of a proposition.
 * Shared by propositions/page.tsx and propositions/[id]/page.tsx.
 */
export function PropositionStatusBadge({
  status,
}: PropositionStatusBadgeProps) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}
