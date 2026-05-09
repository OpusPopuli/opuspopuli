"use client";

import { useState, useId } from "react";
import { useTranslation } from "react-i18next";
import type {
  CivicsMeasureType,
  CivicsLifecycleStage,
} from "@/lib/graphql/region";
import { LifecycleProgressBar } from "./LifecycleProgressBar";

interface HowABillBecomesLawProps {
  measureTypes: CivicsMeasureType[];
  lifecycleStages: CivicsLifecycleStage[];
}

/**
 * Abstract lifecycle diagram for the civics hub.
 * Shows the full stage sequence for the selected measure type with no
 * bill-specific current stage (LifecycleProgressBar in abstract mode).
 * Measure type selector covers all types returned by the region.
 */
export function HowABillBecomesLaw({
  measureTypes,
  lifecycleStages,
}: HowABillBecomesLawProps) {
  const { t } = useTranslation("civics");
  const selectId = useId();

  const [selectedCode, setSelectedCode] = useState(measureTypes[0]?.code ?? "");

  const stageMap = new Map(lifecycleStages.map((s) => [s.id, s]));
  const selectedType = measureTypes.find((mt) => mt.code === selectedCode);
  const stages = (selectedType?.lifecycleStageIds ?? [])
    .map((id) => stageMap.get(id))
    .filter(Boolean) as CivicsLifecycleStage[];

  if (measureTypes.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Measure type selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("lifecycle.measureTypeLabel")}
        </label>
        <select
          id={selectId}
          value={selectedCode}
          onChange={(e) => setSelectedCode(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          {measureTypes.map((mt) => (
            <option key={mt.code} value={mt.code}>
              {mt.code} — {mt.name}
            </option>
          ))}
        </select>
      </div>

      {/* Abstract hint */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("lifecycle.abstractMode")}
      </p>

      {/* Progress bar in abstract mode */}
      {stages.length > 0 ? (
        <LifecycleProgressBar stages={stages} currentStageId={null} />
      ) : (
        <p className="py-4 text-center text-sm text-gray-400">
          {t("hub.noData")}
        </p>
      )}

      {/* Selected type purpose */}
      {selectedType && (
        <p className="mt-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-400">
          {selectedType.purpose.plainLanguage}
        </p>
      )}
    </div>
  );
}
