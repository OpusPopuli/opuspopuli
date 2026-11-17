"use client";

import { useTranslation } from "react-i18next";
import { useCivics } from "@/components/civics/CivicsContext";
import { MeasureTypeTable } from "@/components/civics/MeasureTypeTable";
import { GlossaryList } from "@/components/civics/GlossaryList";
import { HowABillBecomesLaw } from "@/components/civics/HowABillBecomesLaw";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { AiReceipt } from "@/components/ai/AiReceipt";

export default function HowItWorksPage() {
  const { t } = useTranslation("civics");
  const { civics, loading } = useCivics();

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-surface-sunk" />
          <div className="h-4 w-96 rounded bg-surface-sunk" />
          <div className="h-48 rounded bg-surface-sunk" />
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
        <p className="text-content-dim">{t("hub.noData")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {/* Page header */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-content">{t("hub.title")}</h1>
        {civics.sessionScheme && (
          <p className="mt-2 text-content-dim">
            {civics.sessionScheme.description.plainLanguage}
          </p>
        )}
      </header>

      {/* Measure type comparison table */}
      {civics.measureTypes.length > 0 && (
        <section aria-labelledby="measure-types-heading" className="mb-12">
          <h2
            id="measure-types-heading"
            className="mb-1 text-xl font-semibold text-content"
          >
            {t("measureTypes.title")}
          </h2>
          <p className="mb-4 text-sm text-content-dim">
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
            className="mb-1 text-xl font-semibold text-content"
          >
            {t("lifecycle.title")}
          </h2>
          <p className="mb-4 text-sm text-content-dim">
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
            className="mb-1 text-xl font-semibold text-content"
          >
            {t("glossary.title")}
          </h2>
          <p className="mb-4 text-sm text-content-dim">
            {civics.glossary.length} terms
          </p>
          <GlossaryList entries={civics.glossary} />
        </section>
      )}

      {/* Receipts (#1450): the plain-language text above was written by a
          model from these official pages, one receipt each. Every term,
          stage and type names its page, which is how a reader matches it
          to the receipt here. */}
      {civics.sources && civics.sources.length > 0 && (
        <section aria-labelledby="sources-heading" className="mt-12">
          <h2
            id="sources-heading"
            className="mb-1 text-xl font-semibold text-content"
          >
            {t("sources.title")}
          </h2>
          <p className="mb-4 text-sm text-content-dim">{t("sources.intro")}</p>
          <ul className="space-y-3">
            {civics.sources.map((source) => (
              <li
                key={source.sourceUrl ?? source.promptHash ?? ""}
                className="rounded-lg border border-line p-3"
              >
                <AiGeneratedBadge kind={source.kind} />
                <AiReceipt provenance={source} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
