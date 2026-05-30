"use client";

import { useTranslation } from "react-i18next";
import { BriefingSection } from "../BriefingSection";
import { PlaceholderBody } from "./PlaceholderBody";

const REPS_ISSUE = 769;

export function RepsBriefingPlaceholder() {
  const { t } = useTranslation("briefing");
  return (
    <BriefingSection
      slug="reps"
      title={t("reps.title")}
      subtitle={t("reps.subtitle")}
      seeAllHref="/region/representatives"
      icon={
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
      }
    >
      <PlaceholderBody i18nKey="reps" issueNumber={REPS_ISSUE} />
    </BriefingSection>
  );
}
