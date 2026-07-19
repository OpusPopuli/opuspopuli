"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { CommitteeBriefingItem } from "@/lib/graphql/personalized-committees";
import { CommitteeWhyThisPanel } from "./CommitteeWhyThisPanel";

interface CommitteeBriefingCardProps {
  readonly item: CommitteeBriefingItem;
}

/**
 * One committee on the briefing surface (opuspopuli#836 follow-up to
 * #770). Card-level structure mirrors `RepBriefingCard` and
 * `BillBriefingCard` so the page has a consistent visual rhythm —
 * including the collapsible `CommitteeWhyThisPanel` for the LLM-written
 * "why is this on my briefing?" disclosure.
 */
export function CommitteeBriefingCard({ item }: CommitteeBriefingCardProps) {
  const { t } = useTranslation("briefing");
  // The parent `useCommitteesBriefing` hook already filters out items
  // without a populated `relevanceExplanation`, so this is always set
  // by the time we render here. Guard anyway for type narrowing.
  if (!item.relevanceExplanation) return null;

  return (
    <article
      className="rounded-lg border border-line bg-surface p-4"
      data-testid="committee-briefing-card"
      data-committee-id={item.id}
    >
      <Link
        href={`/region/legislative-committees/${item.id}`}
        className="block text-base font-semibold text-content hover:text-content transition-colors line-clamp-1"
      >
        {item.name}
      </Link>
      <p className="mt-0.5 text-xs text-content-dim">
        {t("committees.chamberMembers", {
          chamber: item.chamber,
          count: item.memberCount,
        })}
      </p>

      <div className="mt-3">
        <CommitteeWhyThisPanel
          scopeId={item.id}
          llmExplanation={item.relevanceExplanation}
        />
      </div>
    </article>
  );
}
