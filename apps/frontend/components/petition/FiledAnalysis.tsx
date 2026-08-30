"use client";

import { useTranslation } from "react-i18next";
import type { LinkedProposition } from "@/lib/graphql/documents";

/**
 * What the FILED measure says — the payoff of verifying a scan (#1074 Phase B).
 *
 * This is not a re-reading of the photograph. It is the analysis already
 * generated from the measure's authoritative full text, the same one rendered
 * at /region/propositions/[id]. Showing it here is the difference between "a
 * clearer read of what you were handed" and "what you would have found if you
 * had read the filing".
 *
 * ── Why reuse rather than generate ──────────────────────────────────────────
 *
 * The plan originally called for a second analysis, prompting an LLM with the
 * filed text. That would have produced a *different* reading of the same
 * document from the one the propositions surface shows — the same measure
 * would say two different things depending on where you met it. It would also
 * have had to solve a context-length problem that is not solved even for the
 * existing path (#1085).
 *
 * ── Why it renders separately from the match hero ───────────────────────────
 *
 * The hero above is a single large <Link>. Text this long inside a link is
 * awkward to read and impossible to select, so this sits outside it.
 *
 * Renders nothing without an analysis. Four propositions currently have none
 * (#1085), and a verified match to one of those must fall through to the
 * photo-derived analysis rather than show an empty panel.
 */
export function FiledAnalysis({
  proposition,
}: Readonly<{ proposition?: LinkedProposition }>) {
  const { t } = useTranslation("petition");

  if (!proposition?.analysisSummary) return null;

  const {
    analysisSummary,
    keyProvisions,
    yesOutcome,
    noOutcome,
    fiscalImpact,
  } = proposition;

  return (
    <section
      aria-labelledby="filed-analysis-title"
      data-testid="filed-analysis"
      className="rounded-lg border border-line bg-surface-alt p-5"
    >
      <h2
        id="filed-analysis-title"
        className="font-display text-lg font-bold text-content"
      >
        {t("filedAnalysis.title")}
      </h2>
      <p className="mt-1 text-xs text-content-dim">
        {t("filedAnalysis.provenance")}
      </p>

      <p className="mt-4 text-sm leading-relaxed text-content">
        {analysisSummary}
      </p>

      {keyProvisions && keyProvisions.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-content">
            {t("filedAnalysis.keyProvisions")}
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-content-dim">
            {keyProvisions.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {/*
        What a yes or a no actually does. This is the single most useful thing
        on the page for someone holding a clipboard and a pen, and it is the
        part a circulator's pitch is least likely to have covered evenly.
      */}
      {(yesOutcome || noOutcome) && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {yesOutcome && (
            <div className="rounded-lg border border-line p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-content-dim">
                {t("filedAnalysis.ifYes")}
              </h3>
              <p className="mt-1 text-sm text-content">{yesOutcome}</p>
            </div>
          )}
          {noOutcome && (
            <div className="rounded-lg border border-line p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-content-dim">
                {t("filedAnalysis.ifNo")}
              </h3>
              <p className="mt-1 text-sm text-content">{noOutcome}</p>
            </div>
          )}
        </div>
      )}

      {fiscalImpact && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-content">
            {t("filedAnalysis.fiscalImpact")}
          </h3>
          <p className="mt-1 text-sm text-content-dim">{fiscalImpact}</p>
        </div>
      )}
    </section>
  );
}
