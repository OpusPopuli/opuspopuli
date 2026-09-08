"use client";

import { useTranslation } from "react-i18next";
import type { PropositionStatus } from "@/lib/graphql/region";

const STATUS_STYLES: Record<PropositionStatus, { bg: string; text: string }> = {
  PENDING: { bg: "bg-warning-surface", text: "text-warning" },
  PASSED: { bg: "bg-positive-surface", text: "text-positive" },
  FAILED: { bg: "bg-danger-surface", text: "text-danger" },
  WITHDRAWN: { bg: "bg-surface-alt", text: "text-content" },
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
  // Labels come from the same `propositionStatus.*` keys the propositions
  // filter uses (#1155). Hardcoding them here meant the es dropdown read
  // "Aprobada" while the badge on the same row read "Passed".
  const { t } = useTranslation("region");
  const style = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
    >
      {t(`propositionStatus.${status}`)}
    </span>
  );
}
