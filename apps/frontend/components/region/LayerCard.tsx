"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LevelPill, type StackLevel } from "@/components/region/LevelPill";

export interface LayerCardProps {
  readonly level: StackLevel;
  /** Localized level word — also the redundant text for the gold rule. */
  readonly levelLabel: string;
  readonly name: string;
  readonly subtitle?: string | null;
  readonly href: string;
  /**
   * Items in the trailing 7-day window, or `null` when we cannot count
   * this level honestly. `null` and `0` are deliberately different: one
   * means "we did not look", the other means "nothing happened".
   */
  readonly count?: number | null;
  readonly countLabel?: string;
  readonly countUnavailableLabel?: string;
  readonly openLabel: string;
  /** The county's seat line. Absent for every level that has no seat. */
  readonly seat?: ReactNode;
}

/**
 * One government in the stack (#1194).
 *
 * The county carries a 3px gold left rule, and each level carries its own
 * pill colour (see LevelPill). Colour is wayfinding here — how far from you
 * this government sits — not a claim about leverage, and it is never the
 * only carrier: `levelLabel` states the level in words for anyone who
 * cannot see either (WCAG 1.4.1).
 *
 * Cards are links, not accordions. The index stays an index; depth lives
 * on real pages with real URLs.
 */
export function LayerCard({
  level,
  levelLabel,
  name,
  subtitle,
  href,
  count,
  countLabel,
  countUnavailableLabel,
  openLabel,
  seat,
}: LayerCardProps) {
  const isCounty = level === "COUNTY";

  return (
    <div
      className={`rounded-lg border border-line bg-surface ${
        isCounty ? "border-l-[3px] border-l-accent" : ""
      }`}
    >
      <Link
        // prefetch-ok: three static layer routes, one card each
        href={href}
        className="flex items-center gap-4 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content"
      >
        <span className="w-24 shrink-0">
          <LevelPill level={level} label={levelLabel} size="sm" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-content">{name}</span>
          {subtitle && (
            <span className="mt-0.5 block text-sm text-content-dim">
              {subtitle}
            </span>
          )}
        </span>

        <span className="shrink-0 text-right text-sm text-content-dim">
          {/* A missing count renders as its own sentence rather than as a
              zero — "we did not look here" and "nothing happened here" are
              different claims, and only one of them is ours to make. */}
          <span className="block text-content">
            {count === null || count === undefined
              ? countUnavailableLabel
              : countLabel}
          </span>
          <span className="block text-xs">{openLabel}</span>
        </span>
      </Link>

      {seat && (
        <div className="mx-5 mb-4 rounded-md bg-surface-sunk px-4 py-2.5 text-sm">
          {seat}
        </div>
      )}
    </div>
  );
}

/** Formats the window count, marking a capped page as "N+". */
export function formatWindowCount(
  count: number,
  capped: boolean | undefined,
): string {
  return capped ? `${count}+` : String(count);
}
