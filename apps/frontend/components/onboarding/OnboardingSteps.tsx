"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useOnboarding } from "@/lib/onboarding-context";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ScanStep } from "./steps/ScanStep";
import { AnalyzeStep } from "./steps/AnalyzeStep";
import { ExploreStep } from "./steps/ExploreStep";
import { TrackStep } from "./steps/TrackStep";
import { AddressStep } from "./steps/AddressStep";
import { TopicsStep } from "./steps/TopicsStep";
import { LifeContextStep } from "./steps/LifeContextStep";
import { VeteranStep } from "./steps/VeteranStep";

// Indices of steps that own their primary action (Save & Continue button)
// — the global Next/Get Started footer hides for these.
const DATA_STEP_INDICES = new Set([5, 6, 7, 8]);

export function OnboardingSteps() {
  const router = useRouter();
  const { t } = useTranslation("onboarding");
  const {
    currentStep,
    totalSteps,
    nextStep,
    prevStep,
    skipOnboarding,
    completeOnboarding,
  } = useOnboarding();

  const handleComplete = () => {
    completeOnboarding();
    router.push("/region");
  };

  const handleSkip = () => {
    skipOnboarding();
    router.push("/region");
  };

  const isLastStep = currentStep === totalSteps - 1;
  const advance = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      nextStep();
    }
  };

  const steps = [
    <WelcomeStep key="welcome" />,
    <ExploreStep key="explore" />,
    <ScanStep key="scan" />,
    <AnalyzeStep key="analyze" />,
    <TrackStep key="track" />,
    <AddressStep key="address" onComplete={advance} isLastStep={false} />,
    <TopicsStep key="topics" onComplete={advance} isLastStep={false} />,
    <LifeContextStep key="life" onComplete={advance} isLastStep={false} />,
    <VeteranStep key="veteran" onComplete={advance} isLastStep={true} />,
  ];

  const stepOwnsAction = DATA_STEP_INDICES.has(currentStep);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleSkip}
          className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white text-sm transition-colors px-3 py-1"
        >
          {t("skip")}
        </button>
      </div>

      <div
        role="progressbar"
        aria-label={t("progress.label", "Onboarding progress")}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={currentStep + 1}
        className="flex justify-center gap-2 pt-8 pb-4"
      >
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors ${
              i === currentStep
                ? "bg-sage-dark"
                : "bg-gray-300 dark:bg-gray-600"
            }`}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        {steps[currentStep]}
      </div>

      <div className="p-6 flex justify-between items-center min-h-[80px]">
        <button
          onClick={prevStep}
          disabled={currentStep === 0}
          className="px-6 py-3 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white disabled:opacity-0 transition-all"
        >
          {t("back")}
        </button>

        {!stepOwnsAction && (
          <button
            onClick={advance}
            className="px-8 py-3 bg-sage-dark hover:bg-sage-darker text-white rounded-full font-semibold transition-colors"
          >
            {isLastStep ? t("getStarted") : t("next")}
          </button>
        )}
      </div>
    </div>
  );
}
