"use client";

import { useTranslation } from "react-i18next";
import { BriefingSection } from "../BriefingSection";
import { PlaceholderBody } from "./PlaceholderBody";

const COMMITTEES_ISSUE = 770;

export function CommitteesBriefingPlaceholder() {
  const { t } = useTranslation("briefing");
  return (
    <BriefingSection
      slug="committees"
      title={t("committees.title")}
      subtitle={t("committees.subtitle")}
      seeAllHref="/region/legislative-committees"
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
            d="M4 20h16M5 20v-7m14 7v-7M5 13h14M6 13V9a6 6 0 0112 0v4M12 3v3"
          />
        </svg>
      }
    >
      <PlaceholderBody i18nKey="committees" issueNumber={COMMITTEES_ISSUE} />
    </BriefingSection>
  );
}
