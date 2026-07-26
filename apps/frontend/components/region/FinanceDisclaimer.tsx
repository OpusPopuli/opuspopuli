"use client";

import { useTranslation } from "react-i18next";

/**
 * Shared legal/provenance disclaimer for every campaign-finance surface (#962).
 *
 * States the public-source provenance (CAL-ACCESS / FEC) AND — critically —
 * that committee→representative links and donor groupings are automated
 * best-effort matches that may be inaccurate and are **not an allegation** of
 * wrongdoing. This is the safety net against false-attribution liability while
 * attribution accuracy keeps improving (#953). Render it on any surface that
 * shows finance data attributed to a named person or measure.
 */
export function FinanceDisclaimer({
  className = "",
}: {
  readonly className?: string;
}) {
  const { t } = useTranslation("civics");
  // role="note" (not <aside>): a disclaimer is an annotation, not a landmark —
  // an <aside> complementary landmark nested inside the panel's section landmark
  // fails WCAG "landmark-complementary-is-top-level".
  return (
    <div
      role="note"
      aria-label={t("finance.disclaimerLabel")}
      className={`border-t border-line pt-2 text-[11px] leading-relaxed text-content-dim ${className}`}
    >
      <p>{t("finance.sources")}</p>
      <p className="mt-1">{t("finance.bestEffort")}</p>
    </div>
  );
}
