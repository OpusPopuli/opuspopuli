"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface BriefingSectionProps {
  /** Section heading — e.g. "Bills", "Your representatives". */
  readonly title: string;
  /** One-line context for what this section ranks. */
  readonly subtitle?: string;
  /** Optional decorative icon next to the title. */
  readonly icon?: ReactNode;
  /** Render the section body — featured item + list, or placeholder. */
  readonly children: ReactNode;
  /** Route that the "See all" affordance lands on. */
  readonly seeAllHref: string;
  /** Override the default "See all →" label (i18n: briefing.section.seeAll). */
  readonly seeAllLabel?: string;
  /**
   * `data-section` exposes the consumer's identity for e2e selectors
   * and any future telemetry. Use the slug ("bills", "reps", etc.).
   */
  readonly slug: string;
}

/**
 * Domain-agnostic shell for one card on the civic briefing home page.
 * Each personalized section (Bills now, Reps/Committees/Propositions in
 * #769/#770/#771) wraps its content in this so the four cards on the
 * home page share the same chrome — title row, body, see-all linkout.
 *
 * Per the issue, "See all" always points at the existing /region/*
 * surface so users can browse the unfiltered domain when the
 * personalized list isn't what they need.
 */
export function BriefingSection({
  title,
  subtitle,
  icon,
  children,
  seeAllHref,
  seeAllLabel,
  slug,
}: BriefingSectionProps) {
  const { t } = useTranslation("briefing");
  return (
    <section
      data-section={slug}
      aria-labelledby={`briefing-section-${slug}-title`}
      className="bg-white dark:bg-gray-800 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-none dark:border dark:border-gray-700 overflow-hidden"
    >
      <header className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <span
              aria-hidden="true"
              className="text-gray-500 dark:text-gray-400 shrink-0 mt-0.5"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2
              id={`briefing-section-${slug}-title`}
              className="text-xl font-semibold text-[#222222] dark:text-white"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-[#4d4d4d] dark:text-gray-300 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <Link
          href={seeAllHref}
          className="text-sm font-medium text-[#5A7A6A] hover:text-[#2D4A3C] dark:text-sage-200 dark:hover:text-white shrink-0 mt-1 whitespace-nowrap"
        >
          {seeAllLabel ?? t("section.seeAll")}
        </Link>
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}
