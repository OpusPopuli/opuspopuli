"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { RelevanceChip } from "../bills/RelevanceChip";
import { WhyThisPanel } from "../bills/WhyThisPanel";
import type { RankedProposition } from "./usePropositionsBriefing";

interface PropositionBriefingCardProps {
  readonly item: RankedProposition;
}

/**
 * One proposition row on the briefing surface (#771). Card-level
 * structure mirrors `BillBriefingCard` so the page has a consistent
 * visual rhythm; the per-row content differs because ballot measures
 * carry yes/no outcomes + an explicit election date instead of a
 * vote-action timeline.
 *
 * No hero variant — propositions surface fewer items per ballot
 * (~3-10) than bills (~hundreds in flight), so a flat list of cards
 * reads cleaner than promoting one to a hero block. If that calculus
 * changes after onboarding-day data lands we can add a hero variant.
 *
 * Endorsement chips are intentionally absent in Phase 1 (Phase 2
 * follow-up: requires the `PropositionEndorsement` data model that
 * doesn't exist yet).
 */
export function PropositionBriefingCard({
  item,
}: PropositionBriefingCardProps) {
  const { t, i18n } = useTranslation("briefing");
  const { proposition, result } = item;
  if (!proposition) return null;

  // Prefer the AI-extracted plain-English summary when it landed;
  // fall back to the raw scraped summary so the card never renders
  // empty. The summary column itself is required at the schema layer
  // so the fallback is virtually always defined.
  const summary = proposition.analysisSummary ?? proposition.summary;
  const electionDate = proposition.electionDate
    ? new Date(proposition.electionDate)
    : null;

  return (
    <article
      className="rounded-lg border border-line bg-surface p-4"
      data-testid="proposition-briefing-card"
      data-proposition-id={proposition.id}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/region/propositions/${proposition.id}`}
            className="block text-base font-semibold text-content hover:text-content transition-colors line-clamp-2"
          >
            {proposition.title}
          </Link>
          <p className="mt-0.5 text-xs text-content-dim">
            {proposition.externalId}
            {electionDate
              ? ` · ${t("propositions.electionDate", {
                  // Thread `i18n.language` so the rendered date matches
                  // the surrounding i18next-translated copy rather than
                  // defaulting to the browser locale (which may diverge
                  // when a user has switched the in-app language).
                  date: electionDate.toLocaleDateString(i18n.language, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }),
                })}`
              : ""}
          </p>
        </div>
        <RelevanceChip score={result.relevanceScore} />
      </div>

      {summary && (
        <p className="mt-2 text-sm text-content-dim line-clamp-3">{summary}</p>
      )}

      {(proposition.yesOutcome || proposition.noOutcome) && (
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {proposition.yesOutcome && (
            <div className="rounded-md bg-surface-alt border border-line p-2">
              <dt className="font-semibold text-content uppercase tracking-wide text-[10px]">
                {t("propositions.yesOutcome")}
              </dt>
              <dd className="text-content line-clamp-2 mt-0.5">
                {proposition.yesOutcome}
              </dd>
            </div>
          )}
          {proposition.noOutcome && (
            <div className="rounded-md bg-surface-alt border border-line p-2">
              <dt className="font-semibold text-content-dim uppercase tracking-wide text-[10px]">
                {t("propositions.noOutcome")}
              </dt>
              <dd className="text-content line-clamp-2 mt-0.5">
                {proposition.noOutcome}
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-3">
        <WhyThisPanel
          axisScores={result.axisScores}
          scopeId={proposition.id}
          llmExplanation={result.relevanceExplanation}
          /* Propositions don't surface a structured signal list yet —
             the proposition scorer is a separate module from the bill
             ranker. Passing [] keeps the contract honest while
             reserving room for a future PropositionContributingSignal. */
          signals={[]}
        />
      </div>
    </article>
  );
}
