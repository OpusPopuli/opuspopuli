"use client";

import { useTranslation } from "react-i18next";
import { useCivics } from "@/components/civics/CivicsContext";
import { MeasureTypeTable } from "@/components/civics/MeasureTypeTable";
import { GlossaryList } from "@/components/civics/GlossaryList";
import { HowABillBecomesLaw } from "@/components/civics/HowABillBecomesLaw";

export default function HowItWorksPage() {
  const { t } = useTranslation("civics");
  const { civics, loading } = useCivics();

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-96 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-48 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </main>
    );
  }

  if (
    !civics ||
    (civics.measureTypes.length === 0 && civics.glossary.length === 0)
  ) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-gray-500 dark:text-gray-400">{t("hub.noData")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {/* Page header */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t("hub.title")}
        </h1>
        {civics.sessionScheme && (
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {civics.sessionScheme.description.plainLanguage}
          </p>
        )}
      </header>

      {/* Measure type comparison table */}
      {civics.measureTypes.length > 0 && (
        <section aria-labelledby="measure-types-heading" className="mb-12">
          <h2
            id="measure-types-heading"
            className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-100"
          >
            {t("measureTypes.title")}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {t("measureTypes.description", { regionName: "California" })}
          </p>
          <MeasureTypeTable
            measureTypes={civics.measureTypes}
            lifecycleStages={civics.lifecycleStages}
          />
        </section>
      )}

      {/* How a bill becomes law */}
      {civics.lifecycleStages.length > 0 && civics.measureTypes.length > 0 && (
        <section aria-labelledby="lifecycle-heading" className="mb-12">
          <h2
            id="lifecycle-heading"
            className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-100"
          >
            {t("lifecycle.title")}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {t("lifecycle.abstractMode")}
          </p>
          <HowABillBecomesLaw
            measureTypes={civics.measureTypes}
            lifecycleStages={civics.lifecycleStages}
          />
        </section>
      )}

      {/* Glossary */}
      {civics.glossary.length > 0 && (
        <section aria-labelledby="glossary-heading">
          <h2
            id="glossary-heading"
            className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-100"
          >
            {t("glossary.title")}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {civics.glossary.length} terms
          </p>
          <GlossaryList entries={civics.glossary} />
        </section>
      )}
    </main>
  );
}
