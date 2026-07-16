"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { RankedRep } from "./useRepsBriefing";
import { RelevanceChip } from "../bills/RelevanceChip";
import { RepWhyThisPanel } from "./RepWhyThisPanel";

interface RepBriefingCardProps {
  readonly item: RankedRep;
}

/**
 * One representative on the briefing surface (#769). Card-level
 * structure mirrors `BillBriefingCard` + `PropositionBriefingCard` so
 * the page has a consistent visual rhythm; the per-row content
 * differs because reps carry a face / chamber+district / party badge
 * + a "what they've been working on" tag list rather than bill /
 * proposition prose.
 *
 * Recent-activity tags render bill numbers (e.g. "AB 1234") not full
 * titles — the constrained card width can't fit 3 wrapped titles
 * cleanly, and bill numbers are the canonical legislative shorthand
 * the rep detail page also uses. Each tag links to `/region/bills/<id>`
 * so a reader can drill in.
 *
 * Contact actions (email, call) are intentionally absent in Phase 1.
 * The rep detail page already carries them; the briefing card is a
 * relevance-surface, not an action-surface. Phase 2 candidate:
 * inline a "Contact <Rep>" affordance once the email pipeline is
 * stable (currently being threshold-driven via Resend, not yet wired
 * to the briefing card).
 */
export function RepBriefingCard({ item }: RepBriefingCardProps) {
  const { t } = useTranslation("briefing");
  const { representative: rep, result, recentBills } = item;
  if (!rep) return null;

  return (
    <article
      className="rounded-lg border border-line bg-surface p-4"
      data-testid="rep-briefing-card"
      data-representative-id={rep.id}
    >
      <div className="flex items-start gap-3">
        {rep.photoUrl ? (
          // `unoptimized` matches the existing rep-photo pattern across
          // /region/representatives + /region/representatives/[id] +
          // /region/legislative-committees/[id] — photoUrl is sourced
          // from state legislature portals (leginfo.legislature.ca.gov
          // and similar) that aren't allowlisted in next.config.mjs
          // images.remotePatterns. Without `unoptimized` Next.js raises
          // "hostname … is not configured" at render time.
          //
          // alt="" is deliberate (NOT alt={rep.name}): the rep-name
          // <Link> immediately to the right is the accessible name for
          // this image group. Using alt={rep.name} would cause a screen
          // reader to announce the name twice. Diverges from the
          // existing rep pages because their entire card IS the link
          // (no separate visible name), so they need the alt to carry
          // the accessible name.
          <Image
            src={rep.photoUrl}
            alt=""
            width={48}
            height={48}
            className="rounded-full object-cover h-12 w-12 flex-shrink-0 bg-surface-alt"
            unoptimized
          />
        ) : (
          <div
            className="rounded-full h-12 w-12 flex-shrink-0 bg-surface-alt flex items-center justify-center text-sm font-medium text-content-dim"
            aria-hidden="true"
          >
            {rep.name
              .split(" ")
              .map((part) => part[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <Link
            href={`/region/representatives/${rep.id}`}
            className="block text-base font-semibold text-content hover:text-content transition-colors line-clamp-1"
          >
            {rep.name}
          </Link>
          <p className="mt-0.5 text-xs text-content-dim">
            {t("reps.chamberDistrict", {
              chamber: rep.chamber,
              district: rep.district,
            })}
            {rep.party ? ` · ${rep.party}` : ""}
          </p>
          {/*
           * "Represents you" badge. Today every rep on the briefing comes
           * from the user's resolved jurisdiction slate (district reps +
           * county supervisors) — so the badge fires for all cards and
           * acts as confirmation rather than differentiation. When the
           * briefing eventually surfaces non-slate reps (e.g. reps on
           * committees the user cares about even if they're in a
           * different district), the badge naturally distinguishes them.
           */}
          <p
            className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface-alt border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-content"
            data-testid="rep-represents-you-badge"
          >
            <span aria-hidden="true">★</span>
            {t("reps.representsYou")}
          </p>
        </div>

        <RelevanceChip score={result.relevanceScore} />
      </div>

      {recentBills.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-content-dim">
            {t("reps.workingOn")}
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {recentBills.map((bill) => (
              <li key={bill.id}>
                <Link
                  href={`/region/bills/${bill.id}`}
                  className="inline-block rounded-md bg-surface-alt border border-line px-2 py-0.5 text-xs font-medium text-content hover:bg-surface-alt transition-colors"
                  title={bill.title}
                >
                  {bill.billNumber}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <RepWhyThisPanel
          axisScores={result.axisScores}
          scopeId={rep.id}
          llmExplanation={result.relevanceExplanation}
        />
      </div>
    </article>
  );
}
