"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { topAxisFor, type AxisScores } from "@/lib/graphql/personalized-feed";

interface WhyThisPanelProps {
  readonly axisScores: AxisScores;
  /**
   * Stable id used to scope `aria-controls` between the disclosure
   * button and its panel. Pass the bill id so multiple cards on the
   * page have distinct ids.
   */
  readonly scopeId: string;
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
export function WhyThisPanel({ axisScores, scopeId }: WhyThisPanelProps) {
  const { t } = useTranslation("briefing");
  const [open, setOpen] = useState(false);
  const top = topAxisFor(axisScores);
  // If the top axis itself scored zero (theoretically possible if a bill
  // is surfaced only by axes 4-7, which today emit 0.0), the heuristic
  // sentence is misleading — fall through to the #745 placeholder note.
  const i18nKey = axisScores[top] > 0 ? AXIS_I18N[top] : null;
  const panelId = `why-${scopeId}`;
  const buttonId = `why-toggle-${scopeId}`;

  return (
    <div>
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-xs font-medium text-[#5A7A6A] hover:text-[#2D4A3C] dark:text-sage-300 dark:hover:text-white"
      >
        {open ? t("whyThis.toggleClose") : t("whyThis.toggleOpen")}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-700 p-3 space-y-2"
        >
          {i18nKey ? (
            <p className="text-sm text-[#222222] dark:text-gray-100">
              {t(i18nKey)}
            </p>
          ) : null}
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            {t("whyThis.placeholderFor745")}
          </p>
        </div>
      )}
    </div>
  );
}
