"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

interface CommitteeWhyThisPanelProps {
  /**
   * Stable id used to scope `aria-controls` between the disclosure
   * button and its panel. Pass the committee id so multiple cards on
   * the page have distinct ids.
   */
  readonly scopeId: string;
  /**
   * LLM-written explanation from the nightly rerank batch
   * (opuspopuli#836). Required — `CommitteesBriefingSection` filters
   * out items without one before rendering the card.
   */
  readonly llmExplanation: string;
}

/**
 * Collapsible disclosure that explains why a committee is on the
 * user's briefing. Mirrors `RepWhyThisPanel` + `WhyThisPanel` (bills)
 * for visual + a11y rhythm, but committees only carry the LLM-written
 * sentence — no per-axis heuristic backup (the rerank service either
 * produces an explanation or returns skip:true, and only explained
 * committees surface in `useCommitteesBriefing`).
 */
export function CommitteeWhyThisPanel({
  scopeId,
  llmExplanation,
}: CommitteeWhyThisPanelProps) {
  const { t } = useTranslation("briefing");
  const [open, setOpen] = useState(false);
  const panelId = `why-committee-${scopeId}`;
  const buttonId = `why-committee-toggle-${scopeId}`;

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
          className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-700 p-3"
        >
          <p className="text-sm text-[#222222] dark:text-gray-100">
            {llmExplanation}
          </p>
        </div>
      )}
    </div>
  );
}
