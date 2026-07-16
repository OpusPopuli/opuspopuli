"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  ACKNOWLEDGE_COMMITMENTS,
  type AcknowledgeCommitmentsData,
} from "@/lib/graphql/commitments";
import { COMMITMENTS_VERSION, COMMITMENT_SLUGS } from "@/lib/commitments";

interface CommitmentsStepProps {
  readonly onComplete: () => void;
}

/**
 * Mandatory ethical-commitments acknowledgement step (#754). The
 * issue's acceptance criterion is that this is acknowledged, not
 * buried in fine print — so unlike the other onboarding data-steps
 * this one:
 *   - has no Skip affordance (the parent OnboardingSteps' global
 *     Next/skip button is also hidden because this index is registered
 *     in DATA_STEP_INDICES)
 *   - keeps the primary action disabled until the checkbox is checked
 *   - links to the full /our-commitments page so the user can read
 *     the binding text outside this dialog before accepting
 *
 * On submit we call `acknowledgeCommitments(version: COMMITMENTS_VERSION)`
 * which writes `commitments_acknowledged_at` + the version to the user
 * row, then completes onboarding via `onComplete()`.
 */
export function CommitmentsStep({ onComplete }: CommitmentsStepProps) {
  const { t } = useTranslation("commitments");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, { loading }] = useMutation<
    AcknowledgeCommitmentsData,
    { version: string }
  >(ACKNOWLEDGE_COMMITMENTS);

  const submit = async () => {
    if (!accepted) return;
    setError(null);
    try {
      await ack({ variables: { version: COMMITMENTS_VERSION } });
      onComplete();
    } catch (e) {
      const message = e instanceof Error ? e.message : t("ack.error");
      setError(message);
    }
  };

  return (
    <div className="w-full max-w-lg" data-testid="onboarding-commitments-step">
      <h2 className="text-2xl font-bold mb-2 text-content">
        {t("ack.heading")}
      </h2>
      <p className="text-content-dim text-sm mb-4">{t("ack.body")}</p>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-4 text-sm text-content mb-4">
        <ol className="space-y-3 list-decimal list-inside">
          {COMMITMENT_SLUGS.map((slug) => (
            <li key={slug}>
              <span className="font-semibold">
                {t(`commitments.${slug}.title`)}
              </span>{" "}
              {t(`commitments.${slug}.body`)}
            </li>
          ))}
        </ol>
      </div>

      <p className="text-xs text-content-dim mb-4">
        <Link
          href="/our-commitments"
          target="_blank"
          rel="noopener"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t("ack.readFullPage")}
        </Link>
      </p>

      <label
        htmlFor="commitments-accept"
        className="flex items-start gap-3 px-4 py-3 rounded-lg border border-line bg-surface cursor-pointer hover:bg-surface-alt transition-colors"
      >
        <input
          id="commitments-accept"
          type="checkbox"
          checked={accepted}
          disabled={loading}
          onChange={(e) => {
            setAccepted(e.target.checked);
            setError(null);
          }}
          className="mt-0.5 w-4 h-4 accent-sage-dark"
        />
        <span className="text-sm text-content">{t("ack.checkbox")}</span>
      </label>

      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400 text-sm pt-3">
          {error}
        </p>
      )}

      <div className="flex justify-end pt-6">
        <button
          type="button"
          onClick={submit}
          disabled={!accepted || loading}
          aria-disabled={!accepted || loading}
          className="px-8 py-3 bg-surface-alt hover:bg-surface-alt text-white rounded-full font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t("ack.submitting") : t("ack.continue")}
        </button>
      </div>
    </div>
  );
}
