"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  topAxisFor,
  type AxisScores,
  type ContributingSignal,
} from "@/lib/graphql/personalized-feed";
import { signalLabel } from "@/lib/personalized-feed-signal-labels";

interface WhyThisPanelProps {
  readonly axisScores: AxisScores;
  /**
   * Stable id used to scope `aria-controls` between the disclosure
   * button and its panel. Pass the bill id so multiple cards on the
   * page have distinct ids.
   */
  readonly scopeId: string;
  /**
   * LLM-written explanation from the nightly batch job (#745). When
   * present, this is rendered as the primary sentence and the
   * heuristic axis sentence is hidden — the LLM line is strictly
   * more informative. Falls through to the heuristic when null/empty.
   */
  readonly llmExplanation?: string | null;
  /**
   * Structured signal list from the scorer (#750). The resolver field
   * is non-null `[ContributingSignal!]!` so callers always pass an
   * array — empty array hides the section.
   */
  readonly signals: ReadonlyArray<ContributingSignal>;
  /**
   * Canonical legislature source URL (#750). When present, renders
   * a "Read the source" link at the bottom of the panel so users can
   * verify the recommendation against the original document. Opens
   * in a new tab — the user is in their personalized briefing flow
   * and we don't want to disrupt that context.
   */
  readonly sourceDocumentUrl?: string | null;
}

const AXIS_I18N: Record<keyof AxisScores, string | null> = {
  directMaterial: "whyThis.axisDirectMaterial",
  valuesAlignment: "whyThis.axisValuesAlignment",
  actionability: "whyThis.axisActionability",
  // Axes 4–7 — v1.1 placeholders, never the top reason today
  indirectMaterial: null,
  coalitionSignal: null,
  counterfactual: null,
  noveltyRepetition: null,
};

/**
 * Collapsible disclosure that explains why a bill is on the user's
 * briefing. v1.0 renders a heuristic sentence keyed on the top
 * scoring axis (directMaterial / valuesAlignment / actionability).
 * When #745 ships an LLM-written sentence the heuristic stays as
 * the offline / opt-out fallback.
 */
export function WhyThisPanel({
  axisScores,
  scopeId,
  llmExplanation,
  signals,
  sourceDocumentUrl,
}: WhyThisPanelProps) {
  const { t } = useTranslation("briefing");
  const [open, setOpen] = useState(false);
  const top = topAxisFor(axisScores);
  const hasSignals = signals.length > 0;
  const hasSource = !!sourceDocumentUrl && sourceDocumentUrl.length > 0;
  // If the top axis itself scored zero (theoretically possible if a bill
  // is surfaced only by axes 4-7, which today emit 0.0), the heuristic
  // sentence is misleading — fall through to the #745 placeholder note.
  const heuristicKey = axisScores[top] > 0 ? AXIS_I18N[top] : null;
  const panelId = `why-${scopeId}`;
  const buttonId = `why-toggle-${scopeId}`;

  // The LLM line (#745) is strictly more informative than the heuristic
  // axis sentence when present. Heuristic stays as the fallback for
  // bills the nightly batch hasn't computed yet, LLM failures, or
  // validator-rejected outputs.
  const hasLlm = !!llmExplanation && llmExplanation.length > 0;

  return (
    <div>
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-xs font-medium text-content hover:text-content"
      >
        {open ? t("whyThis.toggleClose") : t("whyThis.toggleOpen")}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="mt-2 rounded-lg bg-surface-alt border border-line p-3 space-y-2"
        >
          {hasLlm ? (
            <p className="text-sm text-content">{llmExplanation}</p>
          ) : (
            <>
              {heuristicKey ? (
                <p className="text-sm text-content">{t(heuristicKey)}</p>
              ) : null}
              <p className="text-xs text-content-dim italic">
                {t("whyThis.placeholderFor745")}
              </p>
            </>
          )}

          {hasSignals && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-content-dim">
                {t("whyThis.signalsHeading")}
              </p>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs text-content">
                {signals.map((signal, i) => (
                  <li key={`${signal.type}-${signal.key}-${i}`}>
                    {signalLabel(signal, t)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasSource && (
            <p className="pt-1">
              <a
                href={sourceDocumentUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-content hover:text-content underline"
              >
                {t("whyThis.sourceLink")}
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
