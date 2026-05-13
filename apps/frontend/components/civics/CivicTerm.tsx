"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useCivics } from "./CivicsContext";

interface CivicTermProps {
  /**
   * Slug, lowercase term text, or measure-type code (e.g. "AB") used to
   * look up the definition. Lookup order: slug → term → measure-type code.
   */
  term: string;
  children: React.ReactNode;
}

/**
 * Wraps civic-vocabulary text in an accessible tooltip sourced from the
 * region glossary or measure-type definitions. Renders children unchanged
 * when the term is not found — never produces a broken state.
 *
 * Keyboard: tooltip opens on focus, closes on blur/Escape.
 */
export function CivicTerm({ term, children }: CivicTermProps) {
  const { t } = useTranslation("civics");
  const { glossaryMap, glossaryByTerm, measureTypeByCode, loading } =
    useCivics();
  const descId = useId();

  // 1. Try glossary by slug
  const glossaryEntry =
    glossaryMap.get(term) ?? glossaryByTerm.get(term.toLowerCase()) ?? null;

  // 2. Fall back to measure type by code (e.g. "AB", "SB", "ACA")
  const measureType = !glossaryEntry
    ? (measureTypeByCode.get(term.toUpperCase()) ?? null)
    : null;

  const hasMatch = Boolean(glossaryEntry ?? measureType);

  // No match and not loading: render children unchanged.
  if (!loading && !hasMatch) {
    return <>{children}</>;
  }

  const shortDef =
    glossaryEntry?.definition.plainLanguage ??
    measureType?.purpose.plainLanguage ??
    t("tooltip.loading");

  const displayTerm =
    glossaryEntry?.term ?? measureType?.name ?? String(children);

  const learnMoreSlug = glossaryEntry?.slug ?? null;

  return (
    <span className="civic-term group relative inline-block">
      <span
        tabIndex={0}
        aria-describedby={hasMatch ? descId : undefined}
        className="cursor-help border-b border-dashed border-current underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-sm"
      >
        {children}
      </span>

      {hasMatch && (
        <span
          role="tooltip"
          id={descId}
          className={[
            "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2",
            "rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg",
            "text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100",
            "opacity-0 transition-opacity duration-150",
            "group-hover:pointer-events-auto group-hover:opacity-100",
            "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
          ].join(" ")}
        >
          <span className="block font-semibold">{displayTerm}</span>
          <span className="mt-1 block leading-snug text-gray-600 dark:text-gray-300">
            {shortDef}
          </span>
          {learnMoreSlug && (
            <Link
              href={`/region/how-it-works#term-${learnMoreSlug}`}
              className="mt-2 block text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              tabIndex={0}
            >
              {t("tooltip.learnMore")} →
            </Link>
          )}
        </span>
      )}
    </span>
  );
}
