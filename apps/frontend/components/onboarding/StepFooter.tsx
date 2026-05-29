"use client";

import { useTranslation } from "react-i18next";

interface StepFooterProps {
  readonly onSkip: () => void;
  readonly onSubmit: () => void;
  readonly loading: boolean;
  readonly isLastStep: boolean;
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
}: StepFooterProps) {
  const { t } = useTranslation("onboarding");
  const primaryLabelKey = (() => {
    if (loading) return "saving";
    if (isLastStep) return "getStarted";
    return "saveAndContinue";
  })();

  return (
    <div className="flex justify-between items-center pt-6 gap-3">
      <button
        type="button"
        onClick={onSkip}
        disabled={loading}
        className="text-white/70 hover:text-white text-sm px-3 py-2 disabled:opacity-50"
      >
        {t("skipStep")}
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={loading}
        className="px-8 py-3 bg-white text-[#2D4A3C] rounded-full font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
      >
        {t(primaryLabelKey)}
      </button>
    </div>
  );
}
