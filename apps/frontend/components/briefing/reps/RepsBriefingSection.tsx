"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { BriefingSection } from "../BriefingSection";
import { RepBriefingCard } from "./RepBriefingCard";
import { useRepsBriefing } from "./useRepsBriefing";

/**
 * Slice the orchestrator's ranked list to a digestible briefing-card
 * count. The backend returns every above-zero rep sorted by composite
 * — typical CA users have 2-3 state reps + a county supervisor, so
 * the cap rarely bites, but a multi-jurisdiction user with 5+ reps
 * matched on all axes would otherwise create a long scrolling list.
 * 3 matches the briefing-page rhythm bills + props already use.
 */
const SECTION_LIMIT = 3;

/**
 * Personalized rep-activity section for the civic briefing home page
 * (#769). Phase 1: heuristic 3-axis ranking (chamberMatch /
 * committeeMatch / actionAlignment), no LLM rerank, no constituency
 * overlap (Phase 2 follow-up).
 */
export function RepsBriefingSection() {
  const { t } = useTranslation("briefing");
  const { loading, error, noProfile, noDistricts, empty, rankedReps } =
    useRepsBriefing();

  const visibleReps = rankedReps.slice(0, SECTION_LIMIT);
  const itemCount = loading ? undefined : visibleReps.length;

  const repsIcon = (
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
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );

  return (
    <BriefingSection
      slug="reps"
      title={t("reps.title")}
      subtitle={t("reps.subtitle")}
      seeAllHref="/region/representatives"
      icon={repsIcon}
      itemCount={itemCount}
    >
      {noProfile && (
        <div className="rounded-lg border border-dashed border-line p-4">
          <p className="text-sm font-medium text-content">
            {t("page.noProfileTitle")}
          </p>
          <p className="text-sm text-content-dim mt-1">
            {t("page.noProfileBody")}
          </p>
          <Link
            href="/onboarding"
            className="inline-block mt-2 text-sm font-medium text-content hover:text-content"
          >
            {t("page.noProfileCta")}
          </Link>
        </div>
      )}

      {noDistricts && !noProfile && (
        <div className="rounded-lg border border-dashed border-line p-4">
          <p className="text-sm font-medium text-content">
            {t("reps.noDistrictsTitle")}
          </p>
          <p className="text-sm text-content-dim mt-1">
            {t("reps.noDistrictsBody")}
          </p>
          <Link
            href="/me/addresses"
            className="inline-block mt-2 text-sm font-medium text-content hover:text-content"
          >
            {t("reps.noDistrictsCta")}
          </Link>
        </div>
      )}

      {error && !noProfile && !noDistricts && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && !visibleReps.length && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse h-24 rounded-lg bg-surface-alt border border-line"
            />
          ))}
        </div>
      )}

      {empty && <p className="text-sm text-content-dim">{t("reps.empty")}</p>}

      {visibleReps.length > 0 && (
        <div className="space-y-3">
          {visibleReps.map((item) => (
            <RepBriefingCard key={item.result.representativeId} item={item} />
          ))}
        </div>
      )}
    </BriefingSection>
  );
}
