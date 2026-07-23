"use client";

import { useTranslation } from "react-i18next";

import type { ClaimSeverity, MinutesClaimKind } from "@/lib/graphql/region";

import { SEVERITY_STYLES } from "./claim-severity";

/**
 * Badges for a minutes summary claim (#932). `ClaimKindBadge` colour-codes the
 * claim category (decision / concern / controversy / public comment /
 * disclosure); `ClaimSeverityTag` renders the green→amber→red severity ramp
 * for flagged concerns. Styling mirrors the shared region badges
 * (PropositionStatusBadge) and the fiscal-level severity ramp on the bill page.
 * Labels are localised via the `civics` namespace.
 */

const KIND_STYLES: Record<MinutesClaimKind, { bg: string; text: string }> = {
  DECISION: { bg: "bg-blue-100", text: "text-blue-800" },
  CONCERN: { bg: "bg-amber-100", text: "text-amber-800" },
  CONTROVERSY: { bg: "bg-red-100", text: "text-red-800" },
  PUBLIC_COMMENT: { bg: "bg-slate-100", text: "text-slate-700" },
  DISCLOSURE: { bg: "bg-violet-100", text: "text-violet-800" },
};

/** Wire enum value → civics i18n leaf key. */
const KIND_I18N_KEY: Record<MinutesClaimKind, string> = {
  DECISION: "decision",
  CONCERN: "concern",
  CONTROVERSY: "controversy",
  PUBLIC_COMMENT: "publicComment",
  DISCLOSURE: "disclosure",
};

export function ClaimKindBadge({ kind }: { readonly kind: MinutesClaimKind }) {
  const { t } = useTranslation("civics");
  const style = KIND_STYLES[kind] ?? KIND_STYLES.PUBLIC_COMMENT;
  const key = KIND_I18N_KEY[kind] ?? "publicComment";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${style.bg} ${style.text}`}
    >
      {t(`minutes.claimKind.${key}`)}
    </span>
  );
}

const SEVERITY_I18N_KEY: Record<ClaimSeverity, string> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export function ClaimSeverityTag({
  severity,
}: {
  readonly severity: ClaimSeverity;
}) {
  const { t } = useTranslation("civics");
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.LOW;
  const key = SEVERITY_I18N_KEY[severity] ?? "low";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${style}`}
    >
      {t(`minutes.severity.${key}`)}
    </span>
  );
}
