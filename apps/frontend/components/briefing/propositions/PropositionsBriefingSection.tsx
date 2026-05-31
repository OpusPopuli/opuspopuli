"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { BriefingSection } from "../BriefingSection";
import { PropositionBriefingCard } from "./PropositionBriefingCard";
import { usePropositionsBriefing } from "./usePropositionsBriefing";

// Smaller default than bills — ballots typically carry 3-10 active
// measures per cycle, not hundreds. Cap of 10 inside the service
// matches the planning-doc "full ballot sized" upper bound.
const FEED_LIMIT = 5;

/**
 * Personalized propositions section for the civic briefing home page
 * (#771). Phase 1: heuristic 3-axis ranking, no LLM rerank, no
 * endorsement chips (Phase 2 follow-up).
 */
export function PropositionsBriefingSection() {
  const { t } = useTranslation("briefing");
  const { loading, error, noProfile, empty, rankedPropositions } =
    usePropositionsBriefing(FEED_LIMIT);

  // Suppress the collapsed-state item count until the feed resolves —
  // showing "(0 items)" while data is still in flight is misleading.
  // Undefined hides the count entirely in the shell.
  const itemCount = loading ? undefined : rankedPropositions.length;

  const propIcon = (
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
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );

  return (
    <BriefingSection
      slug="propositions"
      title={t("propositions.title")}
      subtitle={t("propositions.subtitle")}
      seeAllHref="/region/propositions"
      icon={propIcon}
      itemCount={itemCount}
    >
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

      {loading && !rankedPropositions.length && (
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
          {t("propositions.empty")}
        </p>
      )}

      {rankedPropositions.length > 0 && (
        <div className="space-y-3">
          {rankedPropositions.map((item) => (
            <PropositionBriefingCard
              key={item.result.propositionId}
              item={item}
            />
          ))}
        </div>
      )}
    </BriefingSection>
  );
}
