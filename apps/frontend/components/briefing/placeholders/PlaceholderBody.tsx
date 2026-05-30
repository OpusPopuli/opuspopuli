"use client";

import { useTranslation } from "react-i18next";

interface PlaceholderBodyProps {
  /** i18n key root under `briefing.{slug}.placeholder` — body + comingSoonNote. */
  readonly i18nKey: "reps" | "committees" | "propositions";
  /** Issue number that will replace the placeholder when shipped. */
  readonly issueNumber: number;
}

/**
 * Shared body for the three personalization-pending BriefingSection
 * cards. Renders the "what's coming" copy + a small disclosure note
 * that points at the tracking issue. Honest about the gap; the
 * `<BriefingSection>`'s own "See all →" already wires the user out
 * to the existing /region/* browse surface.
 */
export function PlaceholderBody({
  i18nKey,
  issueNumber,
}: PlaceholderBodyProps) {
  const { t } = useTranslation("briefing");
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#4d4d4d] dark:text-gray-300">
        {t(`${i18nKey}.placeholder.body`)}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
        {t(`${i18nKey}.placeholder.comingSoonNote`)}
        <span className="ml-1">(#{issueNumber})</span>
      </p>
    </div>
  );
}
