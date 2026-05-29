"use client";

import { useTranslation } from "react-i18next";

/**
 * Static disclosure-style placeholders for the three sections the AC
 * calls for but that depend on downstream work:
 *   - Behavioral signals — empty until the behavioral worker ships
 *   - Relevance weights — empty until #743 / #745 ranking metadata
 *   - Event log — empty until the behavioral emission pipeline ships
 *
 * Showing the sections (rather than hiding them) honors the planning
 * doc §8.1 promise that the user can see *everything* that lives on
 * them, including "nothing yet."
 */

interface PlaceholderProps {
  readonly i18nKey: "behavioral" | "weights" | "events";
}

function Placeholder({ i18nKey }: PlaceholderProps) {
  const { t } = useTranslation("profile");
  return (
    <section className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5">
      <h2 className="text-base font-semibold text-gray-900">
        {t(`placeholder.${i18nKey}.title`)}
      </h2>
      <p className="text-sm text-gray-600 mt-1">
        {t(`placeholder.${i18nKey}.body`)}
      </p>
    </section>
  );
}

export const BehavioralSignalsPlaceholder = () => (
  <Placeholder i18nKey="behavioral" />
);
export const RelevanceWeightsPlaceholder = () => (
  <Placeholder i18nKey="weights" />
);
export const EventLogPlaceholder = () => <Placeholder i18nKey="events" />;
