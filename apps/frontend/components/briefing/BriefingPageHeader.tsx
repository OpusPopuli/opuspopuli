"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

/**
 * Top of the civic briefing home page. Renders the page title +
 * subtitle plus a right-aligned "Browse all civic data →" link to
 * /region so users have a one-click escape into the data-browse
 * hub from any personalized briefing context.
 */
export function BriefingPageHeader() {
  const { t } = useTranslation("briefing");
  return (
    <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 pb-2">
      <div>
        <h1 className="text-3xl font-bold text-[#222222] dark:text-white">
          {t("page.title")}
        </h1>
        <p className="text-base text-[#4d4d4d] dark:text-gray-300 mt-1">
          {t("page.subtitle")}
        </p>
      </div>
      <Link
        href="/region"
        aria-label={t("page.browseAllAria")}
        className="text-sm font-medium text-[#5A7A6A] hover:text-[#2D4A3C] dark:text-sage-200 dark:hover:text-white whitespace-nowrap"
      >
        {t("page.browseAllLink")}
      </Link>
    </header>
  );
}
