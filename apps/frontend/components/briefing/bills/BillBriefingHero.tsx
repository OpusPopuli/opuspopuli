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
    <article className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/region/bills/${bill.id}`}
            className="block text-xl sm:text-2xl font-bold text-content hover:text-content transition-colors"
          >
            {bill.title}
          </Link>
          <p className="mt-1 text-xs text-content-dim uppercase tracking-wider">
            {bill.billNumber} · {bill.sessionYear}
          </p>
        </div>
        <RelevanceChip score={result.relevanceScore} size="md" />
      </div>
      {summary && <p className="mt-3 text-sm text-content-dim">{summary}</p>}
      {bill.status && (
        <p className="mt-3 text-xs text-content-dim">
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
          className="text-xs font-medium text-content hover:text-content"
        >
          {t("bills.readBillLink")}
        </Link>
      </div>
      <div className="mt-4 rounded-lg border border-dashed border-line p-3 space-y-1">
        <p className="text-xs text-content-dim italic">
          {t("stubs.counterFrame")}
        </p>
        <p className="text-xs text-content-dim italic">
          {t("stubs.actionAffordances")}
        </p>
      </div>
    </article>
  );
}
