"use client";

import { useTranslation } from "react-i18next";
import type { AiProvenanceKind } from "@/lib/graphql/region";

/**
 * The label above a generated-looking passage (#1450).
 *
 * Replaces four copy-pasted "AI-generated" pills. Takes the receipt's `kind`
 * so the label can never say "AI" for text that is official, hand-written or
 * rendered from data — the pill used to say "AI-generated" unconditionally,
 * including on committee summaries no model wrote.
 *
 * `kind` defaults to AI for callers whose text has only one possible writer
 * and no receipt loaded (list cards).
 */
export function AiGeneratedBadge({
  kind = "AI",
}: {
  readonly kind?: AiProvenanceKind;
}) {
  const { t } = useTranslation("common");
  const isModel = kind === "AI";

  return (
    <span
      className={
        isModel
          ? "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-warning-surface text-warning border border-warning-line"
          : "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-alt text-content-dim border border-line"
      }
    >
      {isModel && (
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
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      )}
      {t(`aiReceipt.badge.${kind}`)}
    </span>
  );
}
