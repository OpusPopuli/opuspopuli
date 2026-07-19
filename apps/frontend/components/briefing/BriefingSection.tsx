"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
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
   * `data-section` exposes the consumer's identity for e2e selectors,
   * any future telemetry, AND the localStorage key that persists this
   * section's collapse state. Use the slug ("bills", "reps", etc.).
   */
  readonly slug: string;
  /**
   * Optional count surfaced when the section is collapsed so the
   * header isn't information-free. Sections with no count (e.g.
   * placeholders) can omit it.
   */
  readonly itemCount?: number;
}

/**
 * Local-storage key for the collapsed/expanded state of a section.
 * Per-section so each card remembers its own state across reloads.
 * Browser-scoped only; per-account persistence is a post-MVP follow-up.
 */
const storageKey = (slug: string) => `briefing:section:${slug}:expanded`;

/**
 * Domain-agnostic shell for one card on the civic briefing home page.
 * Each personalized section (Bills, Reps, Committees, Propositions)
 * wraps its content in this so the four cards on the home page share
 * the same chrome — title row, body, see-all linkout, and the
 * expand/collapse toggle that lets users compress sections they don't
 * want to scan.
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
  itemCount,
}: BriefingSectionProps) {
  const { t } = useTranslation("briefing");

  // SSR-safe default: expanded. The client hydrates with the saved
  // state on mount; one re-render cost on first paint, no hydration
  // mismatch (server always emits "expanded").
  const [isExpanded, setIsExpanded] = useState(true);

  /* eslint-disable react-hooks/set-state-in-effect -- localStorage
     read must happen post-mount to avoid SSR hydration mismatch; the
     setState is a one-shot reconcile when the persisted value differs
     from the SSR default. Pattern matches useBillBriefing + other
     post-hydration syncs in this app. */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(slug));
      if (stored === "false") setIsExpanded(false);
    } catch {
      // localStorage blocked (private-mode Safari, etc.) — fall back to
      // the default-expanded behavior; user can still toggle in-session.
    }
  }, [slug]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggle = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey(slug), String(next));
      } catch {
        // see above — ignore write failures.
      }
      return next;
    });
  };

  const contentId = `briefing-section-${slug}-content`;
  const titleId = `briefing-section-${slug}-title`;
  const ariaLabel = isExpanded
    ? t("section.collapseAria", { title })
    : t("section.expandAria", { title });

  return (
    <section
      data-section={slug}
      aria-labelledby={titleId}
      className="bg-surface rounded-lg dark:border overflow-hidden"
    >
      <header
        className={`flex items-start justify-between gap-4 px-6 pt-6 ${
          isExpanded ? "" : "pb-6"
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          aria-label={ariaLabel}
          className="flex items-start gap-3 min-w-0 flex-1 text-left -mt-1 -mb-1 pt-1 pb-1 rounded focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 dark:focus:ring-offset-gray-800"
        >
          <span
            aria-hidden="true"
            className="text-content-dim shrink-0 mt-1 transition-transform motion-reduce:transition-none"
            style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            {/* Right-pointing chevron — text-only to match the WhyThisPanel
                pattern; no icon-library dependency. */}
            <span className="inline-block w-3 text-xs leading-none font-bold">
              ›
            </span>
          </span>
          {icon && (
            <span
              aria-hidden="true"
              className="text-content-dim shrink-0 mt-0.5"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-semibold text-content">
              {title}
              {!isExpanded && typeof itemCount === "number" && (
                <span className="ml-2 text-sm font-normal text-content-dim">
                  ({t("section.itemCount", { count: itemCount })})
                </span>
              )}
            </h2>
            {subtitle && (
              <p className="text-sm text-content-dim mt-0.5">{subtitle}</p>
            )}
          </div>
        </button>
        <Link
          href={seeAllHref}
          className="text-sm font-medium text-content hover:text-content shrink-0 mt-1 whitespace-nowrap"
        >
          {seeAllLabel ?? t("section.seeAll")}
        </Link>
      </header>
      <div
        id={contentId}
        role="region"
        aria-labelledby={titleId}
        className="px-6 py-5"
        hidden={!isExpanded}
      >
        {children}
      </div>
    </section>
  );
}
