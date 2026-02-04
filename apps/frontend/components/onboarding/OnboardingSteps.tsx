"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useOnboarding } from "@/lib/onboarding-context";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ScanStep } from "./steps/ScanStep";
import { AnalyzeStep } from "./steps/AnalyzeStep";
import { TrackStep } from "./steps/TrackStep";

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
    router.push("/petition");
  };

  const handleSkip = () => {
    skipOnboarding();
    router.push("/petition");
  };

  const steps = [
    <WelcomeStep key="welcome" />,
    <ScanStep key="scan" />,
    <AnalyzeStep key="analyze" />,
    <TrackStep key="track" />,
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#6f42c1] to-[#4c1d95] flex flex-col">
      {/* Skip button */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleSkip}
          className="text-white/70 hover:text-white text-sm transition-colors px-3 py-1"
        >
          {t("skip")}
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-2 pt-8 pb-4">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors ${
              i === currentStep ? "bg-white" : "bg-white/30"
            }`}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-6">
        {steps[currentStep]}
      </div>

      {/* Navigation */}
      <div className="p-6 flex justify-between items-center">
        <button
          onClick={prevStep}
          disabled={currentStep === 0}
          className="px-6 py-3 text-white/70 hover:text-white disabled:opacity-0 transition-all"
        >
          {t("back")}
        </button>

        {currentStep === totalSteps - 1 ? (
          <button
            onClick={handleComplete}
            className="px-8 py-3 bg-white text-[#6f42c1] rounded-full font-semibold hover:bg-white/90 transition-colors"
          >
            {t("getStarted")}
          </button>
        ) : (
          <button
            onClick={nextStep}
            className="px-8 py-3 bg-white/20 text-white rounded-full font-semibold hover:bg-white/30 transition-colors"
          >
            {t("next")}
          </button>
        )}
      </div>
    </div>
  );
}
