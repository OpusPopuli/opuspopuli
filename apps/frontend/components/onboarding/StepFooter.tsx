"use client";

import { useTranslation } from "react-i18next";

interface StepFooterProps {
  readonly onSkip: () => void;
  readonly onSubmit: () => void;
  readonly loading: boolean;
  readonly isLastStep: boolean;
  /** Overrides "Skip this" where the step offers a named alternative instead. */
  readonly skipLabelKey?: string;
  /** Overrides the primary label where the step's action has its own name. */
  readonly submitLabelKey?: string;
}

/**
 * Shared footer for onboarding data-collection steps. Renders the
 * per-step "Skip this" button on the left and the primary action
 * ("Save & Continue" / "Get Started" / loading "Saving…") on the
 * right. Centralizing this here lets each step focus on its form
 * shape, keeps the i18n keys in one place, and prevents button-
 * styling drift between steps.
 */
export function StepFooter({
  onSkip,
  onSubmit,
  loading,
  isLastStep,
  skipLabelKey,
  submitLabelKey,
}: StepFooterProps) {
  const { t } = useTranslation("onboarding");
  const primaryLabelKey = (() => {
    if (loading) return "saving";
    if (submitLabelKey) return submitLabelKey;
    if (isLastStep) return "getStarted";
    return "saveAndContinue";
  })();

  return (
    <div className="flex justify-between items-center pt-6 gap-3">
      <button
        type="button"
        onClick={onSkip}
        disabled={loading}
        className="text-content-dim hover:text-content text-sm px-3 py-2 disabled:opacity-50"
      >
        {t(skipLabelKey ?? "skipStep")}
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={loading}
        className="px-8 py-3 bg-inverse-surface hover:opacity-90 text-on-inverse rounded-full font-semibold transition-colors disabled:opacity-50"
      >
        {t(primaryLabelKey)}
      </button>
    </div>
  );
}
