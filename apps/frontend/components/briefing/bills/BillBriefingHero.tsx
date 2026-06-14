"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { RankedBill } from "./useBillBriefing";
import { RelevanceChip } from "./RelevanceChip";
import { WhyThisPanel } from "./WhyThisPanel";

interface BillBriefingHeroProps {
  readonly item: RankedBill;
}

/**
 * Featured top card of the bills briefing — bigger title, full
 * plain-English summary, large relevance chip + Why-this disclosure.
 *
 * Counter-frame (#751) + action-affordance (#753) stubs render as
 * disclosure-only `<p>` until those pipelines ship; the placement
 * lets the future components slot in without restructuring this card.
 */
export function BillBriefingHero({ item }: BillBriefingHeroProps) {
  const { t } = useTranslation("briefing");
  const { bill, result } = item;
  if (!bill) return null;

  const summary = bill.subject ?? bill.lastAction ?? null;

  return (
    <article className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/region/bills/${bill.id}`}
            className="block text-xl sm:text-2xl font-bold text-[#222222] dark:text-white hover:text-[#5A7A6A] dark:hover:text-sage-300 transition-colors"
          >
            {bill.title}
          </Link>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {bill.billNumber} · {bill.sessionYear}
          </p>
        </div>
        <RelevanceChip score={result.relevanceScore} size="md" />
      </div>
      {summary && (
        <p className="mt-3 text-sm text-[#4d4d4d] dark:text-gray-300">
          {summary}
        </p>
      )}
      {bill.status && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-semibold">{t("bills.statusLabel")}</span>{" "}
          {bill.status}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <WhyThisPanel
          axisScores={result.axisScores}
          scopeId={bill.id}
          llmExplanation={result.relevanceExplanation}
          signals={result.contributingSignals}
          sourceDocumentUrl={result.sourceDocumentUrl}
        />
        <Link
          href={`/region/bills/${bill.id}`}
          className="text-xs font-medium text-[#5A7A6A] hover:text-[#2D4A3C] dark:text-sage-300 dark:hover:text-white"
        >
          {t("bills.readBillLink")}
        </Link>
      </div>
      <div className="mt-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-3 space-y-1">
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          {t("stubs.counterFrame")}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          {t("stubs.actionAffordances")}
        </p>
      </div>
    </article>
  );
}
