"use client";

import { useTranslation } from "react-i18next";

interface RelevanceChipProps {
  /** Composite score 0.0–1.0 from the personalized-feed ranker. */
  readonly score: number;
  readonly size?: "sm" | "md";
}

/**
 * Renders the 0.0–1.0 composite relevance as a percentage chip.
 * Higher scores fill darker; this gives a quick scan signal at a
 * glance without burying the citizen in numbers.
 */
function tierFor(pct: number): string {
  if (pct >= 70) return "bg-accent text-white border-accent";
  if (pct >= 40) {
    return "bg-accent/15 text-content border-accent/40 ";
  }
  return "bg-surface-alt text-content border-line ";
}

export function RelevanceChip({ score, size = "sm" }: RelevanceChipProps) {
  const { t } = useTranslation("briefing");
  const pct = Math.round(score * 100);
  const tier = tierFor(pct);
  const sizeCls =
    size === "md"
      ? "px-3 py-1 text-sm font-semibold"
      : "px-2.5 py-0.5 text-xs font-semibold";
  // `role="img"` legitimizes the `aria-label` on the span (without it,
  // axe flags `aria-prohibited-attr` because a bare span doesn't admit
  // ARIA labels). Screen readers announce the composed label as a
  // single string — "Relevance 65%" — instead of reading the two inner
  // spans separately.
  return (
    <span
      role="img"
      className={`inline-flex items-center gap-1 rounded-full border ${sizeCls} ${tier}`}
      aria-label={`${t("whyThis.scoreLabel")} ${pct}%`}
    >
      <span aria-hidden="true">{t("whyThis.scoreLabel")}</span>
      <span aria-hidden="true">{pct}%</span>
    </span>
  );
}
