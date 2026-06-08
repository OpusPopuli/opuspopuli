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
      className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
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
            className="rounded-full object-cover h-12 w-12 flex-shrink-0 bg-gray-100 dark:bg-gray-700"
            unoptimized
          />
        ) : (
          <div
            className="rounded-full h-12 w-12 flex-shrink-0 bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-400 dark:text-gray-500"
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
            className="block text-base font-semibold text-[#222222] dark:text-white hover:text-[#5A7A6A] dark:hover:text-sage-300 transition-colors line-clamp-1"
          >
            {rep.name}
          </Link>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t("reps.chamberDistrict", {
              chamber: rep.chamber,
              district: rep.district,
            })}
            {rep.party ? ` · ${rep.party}` : ""}
          </p>
        </div>

        <RelevanceChip score={result.relevanceScore} />
      </div>

      {recentBills.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#4d4d4d] dark:text-gray-400">
            {t("reps.workingOn")}
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {recentBills.map((bill) => (
              <li key={bill.id}>
                <Link
                  href={`/region/bills/${bill.id}`}
                  className="inline-block rounded-md bg-sage-50 dark:bg-sage-900/30 border border-sage-200 dark:border-sage-700 px-2 py-0.5 text-xs font-medium text-[#2D4A3C] dark:text-sage-200 hover:bg-sage-100 dark:hover:bg-sage-800/40 transition-colors"
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
