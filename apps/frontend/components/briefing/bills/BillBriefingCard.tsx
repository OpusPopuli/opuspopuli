"use client";

import Link from "next/link";
import type { RankedBill } from "./useBillBriefing";
import { RelevanceChip } from "./RelevanceChip";
import { WhyThisPanel } from "./WhyThisPanel";

interface BillBriefingCardProps {
  readonly item: RankedBill;
}

/**
 * Compact non-featured card. Reuses the same Why-this disclosure
 * and the same #751/#753 stub slots as the hero but in a tighter
 * row meant for stacks of 4–9 underneath the hero.
 */
export function BillBriefingCard({ item }: BillBriefingCardProps) {
  const { bill, result } = item;
  if (!bill) return null;

  const summary = bill.subject ?? bill.lastAction ?? null;

  return (
    <article className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/region/bills/${bill.id}`}
            className="block text-base font-semibold text-[#222222] dark:text-white hover:text-[#5A7A6A] dark:hover:text-sage-300 transition-colors line-clamp-2"
          >
            {bill.title}
          </Link>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {bill.billNumber} · {bill.sessionYear}
            {bill.status ? ` · ${bill.status}` : ""}
          </p>
        </div>
        <RelevanceChip score={result.relevanceScore} />
      </div>
      {summary && (
        <p className="mt-2 text-sm text-[#4d4d4d] dark:text-gray-300 line-clamp-2">
          {summary}
        </p>
      )}
      <div className="mt-2">
        <WhyThisPanel
          axisScores={result.axisScores}
          scopeId={bill.id}
          llmExplanation={result.relevanceExplanation}
        />
      </div>
    </article>
  );
}
