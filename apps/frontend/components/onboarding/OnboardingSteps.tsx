"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useOnboarding } from "@/lib/onboarding-context";
import { CountyStep } from "./steps/CountyStep";
import { ThresholdStep } from "./steps/ThresholdStep";
import { TopicsStep } from "./steps/TopicsStep";
import { VeteranStep } from "./steps/VeteranStep";
import { ExpectationsStep } from "./steps/ExpectationsStep";
import { CommitmentsStep } from "./steps/CommitmentsStep";

/**
 * Six steps: county, what it takes, what you watch, one sensitive question,
 * what to expect, commitments.
 *
 * It was ten. Four of those were consecutive product slides shown before a
 * single question — a reader who had just clicked "Get started" had already
 * been sold, and two of the four advertised work still in progress. They are
 * replaced by one honest Live/Building screen near the end, where it answers
 * a question the reader has by then actually formed.
 *
 * The address moved from sixth to first, because it is the only thing the
 * product cannot proceed without, and step 2 spends itself paying for it.
 */
const STEP_KEYS = [
  "county",
  "threshold",
  "topics",
  "veteran",
  "expectations",
  "commitments",
] as const;

// The commitments acknowledgement (#754) is mandatory: the issue AC says it
// MUST be acknowledged, not skipped. The index derives from STEP_KEYS so the
// chrome-suppression check below cannot drift from the step order.
const COMMITMENTS_INDEX = STEP_KEYS.indexOf("commitments");

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
    router.push("/me/briefing");
  };

  const handleSkip = () => {
    skipOnboarding();
    router.push("/me/briefing");
  };

  const isLastStep = currentStep === totalSteps - 1;
  const advance = () => (isLastStep ? handleComplete() : nextStep());

  // Every step owns its own primary action now — there is no step left whose
  // only content is a slide to click past — so the flow carries no global
  // Next button.
  const steps = [
    <CountyStep key="county" onComplete={advance} />,
    <ThresholdStep key="threshold" onComplete={advance} onCorrect={prevStep} />,
    <TopicsStep key="topics" onComplete={advance} isLastStep={false} />,
    <VeteranStep key="veteran" onComplete={advance} isLastStep={false} />,
    <ExpectationsStep key="expectations" onComplete={advance} />,
    <CommitmentsStep key="commitments" onComplete={advance} />,
  ];

  const isCommitmentsStep = currentStep === COMMITMENTS_INDEX;

  return (
    <div className="flex min-h-screen flex-col bg-surface-alt">
      {!isCommitmentsStep && (
        <div className="absolute right-4 top-4 z-10">
          <button
            onClick={handleSkip}
            className="px-3 py-1 text-sm text-content-dim transition-colors hover:text-content"
          >
            {t("skip")}
          </button>
        </div>
      )}

      <StepRail current={currentStep} />

      <div className="flex flex-1 items-start justify-center px-6 pb-10">
        {steps[currentStep]}
      </div>

      <div className="flex min-h-[64px] items-center p-6">
        <button
          onClick={prevStep}
          disabled={currentStep === 0 || isCommitmentsStep}
          // `transition-colors`, not `transition-all`: animating the disabled
          // `opacity-0` fades the label through sub-threshold contrast, and
          // axe sampling mid-fade sees 2.74:1 on a control that is 5:1 at
          // rest. Nothing needs the opacity animated.
          className="px-6 py-3 text-content-dim transition-colors hover:text-content disabled:opacity-0"
        >
          {t("back")}
        </button>
      </div>
    </div>
  );
}

/**
 * The steps by name, not as dots.
 *
 * Six unlabelled dots tell a reader how much is left but not what any of it
 * is, which is exactly the information that decides whether they finish. The
 * names also make the flow's shape an argument in itself: it opens on their
 * county and ends on what we owe them.
 */
function StepRail({ current }: { current: number }) {
  const { t } = useTranslation("onboarding");

  return (
    // `aria-current="step"` is what marks the position; every step also
    // renders "Step N of 6" as its own eyebrow. An extra visually-hidden
    // count here made a screen reader announce it twice.
    <ol
      className="mx-auto flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-1 px-6 pb-4 pt-8 text-xs"
      aria-label={t("progress.label")}
    >
      {STEP_KEYS.map((key, i) => (
        <li
          key={key}
          aria-current={i === current ? "step" : undefined}
          // No opacity on the inactive names: text-content-dim/70 renders
          // #96928b on the step background, which is 2.76:1 and fails WCAG
          // 1.4.3. Weight and colour already separate current from the rest.
          className={
            i === current ? "font-semibold text-content" : "text-content-dim"
          }
        >
          {t(`progress.steps.${key}`)}
        </li>
      ))}
    </ol>
  );
}
