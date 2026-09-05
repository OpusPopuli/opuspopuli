"use client";

import { useTranslation } from "react-i18next";
import { LanguageChoice } from "../LanguageChoice";
import { AddressStep } from "./AddressStep";

interface CountyStepProps {
  readonly onComplete: () => void;
}

/**
 * Step 1: which county is yours?
 *
 * The address used to arrive sixth, after four screens of product pitch,
 * framed as "we use your address to find your local elections". That asks for
 * the most sensitive field the flow collects at the moment attention is
 * thinnest, and gives nothing back for it.
 *
 * It comes first now, and the step that follows spends itself paying for it:
 * the reader hands over a postcode and immediately gets a number about their
 * own county that they did not have. The ask is earned in the same minute it
 * is made.
 *
 * The form itself is unchanged — same create/update reconciliation, same
 * validation. Only the framing around it is new.
 */
export function CountyStep({ onComplete }: CountyStepProps) {
  const { t } = useTranslation("onboarding");

  return (
    <AddressStep
      onComplete={onComplete}
      isLastStep={false}
      skipLabelKey="county.skip"
      header={
        <div className="mb-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <p className="pt-1 text-xs font-semibold uppercase tracking-[0.13em] text-content-dim">
              {t("progress.stepOf", { current: 1, total: 6 })}
            </p>
            {/* The choice belongs before the first thing asking to be read,
                not on a screen the reader has already passed. */}
            <LanguageChoice />
          </div>

          <h2 className="font-serif text-3xl leading-tight text-content">
            {t("county.title")}
          </h2>
          <p className="mt-3 text-content-dim">{t("county.body")}</p>
          <p className="mt-3 text-sm italic text-content-dim">
            {t("county.cite")}
          </p>
          <p className="mt-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-content-dim">
            <strong className="font-semibold text-content">
              {t("county.privacyLead")}
            </strong>{" "}
            {t("county.privacyBody")}
          </p>
        </div>
      }
    />
  );
}
