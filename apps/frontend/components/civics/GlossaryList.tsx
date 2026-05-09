"use client";

import { useState, useId } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import type { CivicsGlossaryEntry } from "@/lib/graphql/region";
import { useCivics } from "./CivicsContext";

interface GlossaryListProps {
  entries: CivicsGlossaryEntry[];
}

/**
 * Searchable glossary list for the /region/how-it-works hub.
 *
 * Each entry has an anchor id="term-{slug}" matching the deep-link target
 * from <CivicTerm> "Learn more" links. scroll-margin-top clears sticky header.
 *
 * Accessibility: search input is labelled, results region announces count
 * changes to screen readers via aria-live.
 */
export function GlossaryList({ entries }: GlossaryListProps) {
  const { t } = useTranslation("civics");
  const [query, setQuery] = useState("");
  const searchId = useId();
  const resultsId = useId();

  const filtered =
    query.trim().length === 0
      ? entries
      : entries.filter(
          (e) =>
            e.term.toLowerCase().includes(query.toLowerCase()) ||
            e.definition.plainLanguage
              .toLowerCase()
              .includes(query.toLowerCase()),
        );

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {t("glossary.searchPlaceholder")}
        </label>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        >
          🔍
        </span>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("glossary.searchPlaceholder")}
          aria-controls={resultsId}
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {/* Results */}
      <div
        id={resultsId}
        role="region"
        aria-label={t("glossary.title")}
        aria-live="polite"
        className="space-y-6"
      >
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {t("glossary.noResults", { query })}
          </p>
        ) : (
          filtered.map((entry) => (
            <GlossaryEntry key={entry.slug} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

function GlossaryEntry({ entry }: { entry: CivicsGlossaryEntry }) {
  const { t } = useTranslation("civics");
  const { glossaryByTerm } = useCivics();
  const [expanded, setExpanded] = useState(false);
  const longDefId = useId();

  return (
    <section
      id={`term-${entry.slug}`}
      aria-labelledby={`term-heading-${entry.slug}`}
      className="scroll-mt-20 border-b border-gray-100 pb-4 last:border-0 dark:border-gray-800"
    >
      <h3
        id={`term-heading-${entry.slug}`}
        className="text-base font-semibold text-gray-900 dark:text-gray-100"
      >
        {entry.term}
      </h3>

      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        {entry.definition.plainLanguage}
      </p>

      {/* Long definition expandable */}
      {entry.longDefinition && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={longDefId}
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
          >
            {expanded ? "▲" : "▼"} {t("glossary.longDefinitionLabel")}
          </button>
          {expanded && (
            <p
              id={longDefId}
              className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400"
            >
              {entry.longDefinition.plainLanguage}
            </p>
          )}
        </div>
      )}

      {/* Related terms — look up real slug via glossaryByTerm */}
      {entry.relatedTerms.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400">
            {t("glossary.relatedTerms")}:
          </span>
          {entry.relatedTerms.map((rt) => {
            const slug =
              glossaryByTerm.get(rt.toLowerCase())?.slug ??
              rt.toLowerCase().replace(/\s+/g, "-");
            return (
              <Link
                key={rt}
                href={`#term-${slug}`}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {rt}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
