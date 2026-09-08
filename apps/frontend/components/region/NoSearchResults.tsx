"use client";

import { useTranslation } from "react-i18next";

/**
 * Empty state for a search that matched nothing (#1155).
 *
 * Distinct from `EmptyState`, which says "No bills found." — true when
 * the corpus is empty, actively misleading when the corpus is fine and
 * the query simply didn't match. The committees page has branched on
 * this since #672; these strings already shipped with #1154 and were
 * going unused.
 */
export function NoSearchResults({ query }: { readonly query: string }) {
  const { t, i18n } = useTranslation("region");
  return (
    <div className="rounded-lg border border-line bg-surface-alt p-8 text-center">
      <p className="font-semibold text-content">
        {t("search.empty.title", { query })}
      </p>
      <p className="mt-1 text-sm text-content-dim">{t("search.empty.body")}</p>
      {i18n.language === "es" && (
        <p className="mt-1 text-sm text-content-dim">
          {t("search.empty.languageNote")}
        </p>
      )}
    </div>
  );
}
