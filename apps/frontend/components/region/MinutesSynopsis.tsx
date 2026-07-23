"use client";

import { useTranslation } from "react-i18next";

/**
 * AI-generated plain-English synopsis of a minutes / journal session (#932,
 * data from #813). Mirrors the shared `ActivitySummary` affordance — amber
 * card, "AI-generated" pill, provenance disclaimer — so users always know
 * which content is machine-summarised. Renders nothing until a synopsis
 * exists (`summary` is null until MinutesSummaryService runs).
 */
export function MinutesSynopsis({
  summary,
}: {
  readonly summary?: string | null;
}) {
  const { t } = useTranslation("civics");
  if (!summary || summary.trim().length === 0) return null;

  return (
    <section
      aria-label={t("minutes.aiPanel.heading")}
      className="bg-amber-50/40 border border-amber-200 rounded-lg p-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
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
          {t("minutes.aiPanel.badge")}
        </span>
        <span className="text-[11px] uppercase tracking-wider font-bold text-content-dim">
          {t("minutes.aiPanel.heading")}
        </span>
      </div>
      <p className="text-content-dim leading-relaxed whitespace-pre-line">
        {summary}
      </p>
      <p className="mt-3 text-[11px] text-content-dim italic">
        {t("minutes.aiPanel.disclaimer")}
      </p>
    </section>
  );
}
