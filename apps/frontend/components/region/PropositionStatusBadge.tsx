"use client";

import type { PropositionStatus } from "@/lib/graphql/region";

const STATUS_STYLES: Record<
  PropositionStatus,
  { bg: string; text: string; label: string }
> = {
  PENDING: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Pending" },
  PASSED: { bg: "bg-green-100", text: "text-green-800", label: "Passed" },
  FAILED: { bg: "bg-red-100", text: "text-red-800", label: "Failed" },
  WITHDRAWN: { bg: "bg-gray-100", text: "text-gray-800", label: "Withdrawn" },
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
