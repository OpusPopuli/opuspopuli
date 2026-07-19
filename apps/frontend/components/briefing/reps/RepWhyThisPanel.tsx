"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  topAxisForRep,
  type RepActivityAxisScores,
} from "@/lib/graphql/personalized-reps";

interface RepWhyThisPanelProps {
  readonly axisScores: RepActivityAxisScores;
  /**
   * Stable id used to scope `aria-controls` between the disclosure
   * button and its panel. Pass the rep id so multiple cards on the
   * page have distinct ids.
   */
  readonly scopeId: string;
  /**
   * LLM-written explanation for Phase 2 of #769 (would reuse the
   * `llm-rerank-worker` infra from #745 with a new prompt-service
   * template). Always null in Phase 1; the heuristic axis sentence
   * is the only path today.
   */
  readonly llmExplanation?: string | null;
}

/**
 * Rep-specific axis-key → i18n-key mapping. The rep axes (chamber /
 * committee / action) carry different semantics from the bill / prop
 * axes (direct material / values / actionability), so the disclosure
 * sentence needs distinct phrasing. Axes 4-7 are 0.0 placeholders in
 * v1.0 same as bills/props — they map to `null` so they're never
 * picked as the "top reason".
 *
 * Worth flagging as a candidate for generalisation: bills, props, and
 * reps each ship their own WhyThisPanel today because the axis
 * vocabularies differ. A future shared `WhyThisPanelBase<TAxes>` could
 * accept the i18n-key map + top-axis-fn as props and collapse the
 * three. Out of scope for #769 — we'd need to refactor the existing
 * bills/props panels in the same PR to avoid drift.
 */
const REP_AXIS_I18N: Record<keyof RepActivityAxisScores, string | null> = {
  chamberMatch: "repsWhyThis.axisChamberMatch",
  committeeMatch: "repsWhyThis.axisCommitteeMatch",
  actionAlignment: "repsWhyThis.axisActionAlignment",
  constituencyOverlap: null,
  coalitionSignal: null,
  counterfactual: null,
  noveltyRepetition: null,
};

/**
 * Collapsible disclosure that explains why a representative is on the
 * user's briefing. v1.0 renders a heuristic sentence keyed on the top
 * scoring axis (chamberMatch / committeeMatch / actionAlignment).
 * When the rep-side LLM rerank ships the heuristic stays as the
 * offline / opt-out fallback — same pattern as the bills'
 * `WhyThisPanel`.
 */
export function RepWhyThisPanel({
  axisScores,
  scopeId,
  llmExplanation,
}: RepWhyThisPanelProps) {
  const { t } = useTranslation("briefing");
  const [open, setOpen] = useState(false);
  const top = topAxisForRep(axisScores);
  // Same guard as the bills panel: if the top axis itself scored zero
  // (theoretically possible if a rep is surfaced only by axes 4-7,
  // which today emit 0.0), the heuristic sentence is misleading. Fall
  // through to the Phase 2 placeholder.
  const heuristicKey = axisScores[top] > 0 ? REP_AXIS_I18N[top] : null;
  const panelId = `why-rep-${scopeId}`;
  const buttonId = `why-rep-toggle-${scopeId}`;

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
        </div>
      )}
    </div>
  );
}
