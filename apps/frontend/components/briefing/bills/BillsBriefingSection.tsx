"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { BriefingSection } from "../BriefingSection";
import { BillBriefingCard } from "./BillBriefingCard";
import { BillBriefingHero } from "./BillBriefingHero";
import { BillsTopicFilter } from "./BillsTopicFilter";
import { useBillBriefing } from "./useBillBriefing";

// Planning-doc §1 / #743 default: top 5 keeps the list at the
// civic-attention sweet spot. Raise if the home page can absorb
// more without diluting focus.
const FEED_LIMIT = 5;

export function BillsBriefingSection() {
  const { t } = useTranslation("briefing");
  const { loading, error, noProfile, empty, topicTags, rankedBills } =
    useBillBriefing(FEED_LIMIT);

  const billIcon = (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );

  return (
    <BriefingSection
      slug="bills"
      title={t("bills.title")}
      subtitle={t("bills.subtitle")}
      seeAllHref="/region/bills"
      icon={billIcon}
    >
      <BillsTopicFilter topics={topicTags} />

      {noProfile && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-4">
          <p className="text-sm font-medium text-[#222222] dark:text-white">
            {t("page.noProfileTitle")}
          </p>
          <p className="text-sm text-[#4d4d4d] dark:text-gray-300 mt-1">
            {t("page.noProfileBody")}
          </p>
          <Link
            href="/onboarding"
            className="inline-block mt-2 text-sm font-medium text-[#5A7A6A] hover:text-[#2D4A3C] dark:text-sage-300 dark:hover:text-white"
          >
            {t("page.noProfileCta")}
          </Link>
        </div>
      )}

      {error && !noProfile && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && !rankedBills.length && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse h-24 rounded-xl bg-gray-100 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-700"
            />
          ))}
        </div>
      )}

      {empty && (
        <p className="text-sm text-[#4d4d4d] dark:text-gray-300">
          {t("bills.empty")}
        </p>
      )}

      {rankedBills.length > 0 && (
        <div className="space-y-4">
          {rankedBills[0] && <BillBriefingHero item={rankedBills[0]} />}
          {rankedBills.length > 1 && (
            <div className="space-y-3">
              {rankedBills.slice(1).map((item) => (
                <BillBriefingCard key={item.result.billId} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </BriefingSection>
  );
}
