"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BriefingSection } from "../BriefingSection";
import { useCommitteesBriefing } from "./useCommitteesBriefing";
import { CommitteeBriefingCard } from "./CommitteeBriefingCard";

/**
 * Personalized committees briefing section (opuspopuli#836 follow-up to
 * #770). Mirrors `RepsBriefingSection` for structure. Renders top-N
 * committees whose nightly LLM batch produced a topical relevance
 * explanation for this user.
 *
 * Empty / loading state collapses to the same placeholder copy the
 * pre-#836 implementation showed — once the user has seen the briefing
 * at least once after the nightly batch fires, this section fills in.
 */
export function CommitteesBriefingSection() {
  const { t } = useTranslation("briefing");
  const { committees, loading } = useCommitteesBriefing();

  // Three exclusive branches — extracted to a `body` variable instead
  // of an inline nested ternary so the markup stays under sonarjs's
  // no-nested-conditional rule + the JSX reads top-to-bottom.
  let body: ReactNode;
  if (loading && committees.length === 0) {
    body = (
      <p
        className="text-sm text-content-dim"
        data-testid="committees-briefing-loading"
      >
        {t("committees.loading")}
      </p>
    );
  } else if (committees.length === 0) {
    body = (
      <p
        className="text-sm text-content-dim"
        data-testid="committees-briefing-empty"
      >
        {t("committees.empty")}
      </p>
    );
  } else {
    body = (
      <ul
        className="flex flex-col gap-3"
        data-testid="committees-briefing-list"
      >
        {committees.map((c) => (
          <li key={c.id}>
            <CommitteeBriefingCard item={c} />
          </li>
        ))}
      </ul>
    );
  }

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
      {body}
    </BriefingSection>
  );
}
