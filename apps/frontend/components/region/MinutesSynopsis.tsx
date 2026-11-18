"use client";

import { useTranslation } from "react-i18next";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { AiReceipt } from "@/components/ai/AiReceipt";
import type { AiProvenance } from "@/lib/graphql/region";

/**
 * AI-generated plain-English synopsis of a minutes / journal session (#932,
 * data from #813). Mirrors the shared `ActivitySummary` affordance — amber
 * card, "AI-generated" pill, provenance disclaimer — so users always know
 * which content is machine-summarised. Renders nothing until a synopsis
 * exists (`summary` is null until MinutesSummaryService runs).
 */
export function MinutesSynopsis({
  summary,
  provenance,
}: {
  readonly summary?: string | null;
  /** The synopsis's receipt (#1450). */
  readonly provenance?: AiProvenance | null;
}) {
  const { t } = useTranslation("civics");
  if (!summary || summary.trim().length === 0) return null;

  return (
    <section
      aria-label={t("minutes.aiPanel.heading")}
      className="bg-warning-surface/40 border border-warning-line rounded-lg p-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <AiGeneratedBadge kind={provenance?.kind ?? "AI"} />
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
      <AiReceipt provenance={provenance} />
    </section>
  );
}
