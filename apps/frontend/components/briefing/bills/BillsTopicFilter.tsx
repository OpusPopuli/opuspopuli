"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

interface BillsTopicFilterProps {
  /** The user's stored interest tags (canonical slugs). */
  readonly topics: readonly string[];
}

/**
 * Read-only chip badges showing the user's interest tags. The
 * personalized feed is already ranked against these on the backend
 * so the chips don't filter the list client-side — they exist as a
 * trust signal ("these are the topics driving your briefing") plus
 * an "Edit your interests →" link out to /me/profile.
 *
 * When richer interactive filtering lands (e.g. multi-topic
 * subset selection), this component is the right place to add it.
 */
export function BillsTopicFilter({ topics }: BillsTopicFilterProps) {
  const { t } = useTranslation("briefing");
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {topics.map((topic) => (
        <span
          key={topic}
          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent/10 text-content border border-accent/30"
        >
          {t(`fields.interestTags.options.${topic}`, {
            ns: "profile",
            defaultValue: topic,
          })}
        </span>
      ))}
      <Link
        href="/me/profile"
        className="text-xs font-medium text-content hover:text-content ml-auto"
      >
        {t("bills.broadenLink")}
      </Link>
    </div>
  );
}
