"use client";

import { useTranslation } from "react-i18next";

import type { ClaimSeverity, MinutesSummaryClaim } from "@/lib/graphql/region";

/**
 * At-a-glance badge aggregating a session's `concern` + `controversy` claims
 * (#932): a count plus a colour keyed to the highest severity present, so a
 * citizen can tell whether anything contested happened without expanding the
 * full claim list. Renders nothing when there are no flagged items.
 */

const SEVERITY_RANK: Record<ClaimSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const BADGE_STYLE: Record<ClaimSeverity, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  HIGH: "bg-red-100 text-red-800",
};

function highestSeverity(
  claims: readonly MinutesSummaryClaim[],
): ClaimSeverity {
  return claims.reduce<ClaimSeverity>((max, c) => {
    const s = c.severity ?? "LOW";
    return SEVERITY_RANK[s] > SEVERITY_RANK[max] ? s : max;
  }, "LOW");
}

export function ConcernsBadge({
  claims,
}: {
  readonly claims?: readonly MinutesSummaryClaim[];
}) {
  const { t } = useTranslation("civics");
  const flagged = (claims ?? []).filter(
    (c) => c.kind === "CONCERN" || c.kind === "CONTROVERSY",
  );
  if (flagged.length === 0) return null;

  const style = BADGE_STYLE[highestSeverity(flagged)];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}
    >
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0l-6.93 12a2 2 0 001.74 3z"
        />
      </svg>
      {t("minutes.concerns.badge", { count: flagged.length })}
    </span>
  );
}
