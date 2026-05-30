"use client";

import { useTranslation } from "react-i18next";
import { BriefingSection } from "../BriefingSection";
import { PlaceholderBody } from "./PlaceholderBody";

const PROPOSITIONS_ISSUE = 771;

export function PropositionsBriefingPlaceholder() {
  const { t } = useTranslation("briefing");
  return (
    <BriefingSection
      slug="propositions"
      title={t("propositions.title")}
      subtitle={t("propositions.subtitle")}
      seeAllHref="/region/propositions"
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
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      }
    >
      <PlaceholderBody
        i18nKey="propositions"
        issueNumber={PROPOSITIONS_ISSUE}
      />
    </BriefingSection>
  );
}
