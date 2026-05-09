"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  CivicsMeasureType,
  CivicsLifecycleStage,
} from "@/lib/graphql/region";

interface MeasureTypeTableProps {
  measureTypes: CivicsMeasureType[];
  lifecycleStages: CivicsLifecycleStage[];
}

/**
 * Comparison grid showing all measure types for the region.
 * Lifecycle stages column opens a portal popover so it isn't clipped
 * by the table's overflow-x-auto container.
 * Mobile: horizontally scrollable, first column sticky.
 */
export function MeasureTypeTable({
  measureTypes,
  lifecycleStages,
}: MeasureTypeTableProps) {
  const { t } = useTranslation("civics");
  const stageMap = new Map(lifecycleStages.map((s) => [s.id, s]));

  if (measureTypes.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
        <caption className="sr-only">{t("measureTypes.title")}</caption>
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th
              scope="col"
              className="sticky left-0 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-900 dark:bg-gray-800 dark:text-gray-100"
            >
              {t("measureTypes.columns.code")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-gray-100"
            >
              {t("measureTypes.columns.name")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-gray-100"
            >
              {t("measureTypes.columns.chamber")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-gray-100"
            >
              {t("measureTypes.columns.votingThreshold")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-center font-semibold text-gray-900 dark:text-gray-100"
            >
              {t("measureTypes.columns.reachesGovernor")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-gray-100"
            >
              {t("measureTypes.columns.lifecycleStages")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
          {measureTypes.map((mt) => (
            <MeasureTypeRow
              key={mt.code}
              measureType={mt}
              stageMap={stageMap}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MeasureTypeRow({
  measureType: mt,
  stageMap,
}: {
  measureType: CivicsMeasureType;
  stageMap: Map<string, CivicsLifecycleStage>;
}) {
  const { t } = useTranslation("civics");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const stages = mt.lifecycleStageIds
    .map((id) => stageMap.get(id))
    .filter(Boolean) as CivicsLifecycleStage[];

  const threshold = t(`measureTypes.thresholds.${mt.votingThreshold}`, {
    defaultValue: mt.votingThreshold,
  });

  const openPopover = useCallback(() => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // position: fixed — viewport-relative, won't drift on scroll
      setPopoverPos({ top: rect.bottom + 4, left: rect.left });
    }
    setPopoverOpen(true);
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && btnRef.current?.contains(e.target as Node))
        return;
      setPopoverOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [popoverOpen]);

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <td className="sticky left-0 bg-white px-4 py-3 font-mono font-semibold text-blue-700 dark:bg-gray-900 dark:text-blue-400">
        {mt.code}
      </td>
      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
        <span title={mt.purpose.plainLanguage} className="cursor-help">
          {mt.name}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
        {mt.chamber}
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
        {threshold}
      </td>
      <td className="px-4 py-3 text-center">
        {mt.reachesGovernor ? (
          <span
            aria-label={t("measureTypes.yes")}
            className="text-green-600 dark:text-green-400"
          >
            ✓
          </span>
        ) : (
          <span aria-label={t("measureTypes.no")} className="text-gray-400">
            ✗
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {stages.length > 0 ? (
          <>
            <button
              ref={btnRef}
              type="button"
              aria-expanded={popoverOpen}
              aria-haspopup="listbox"
              onClick={() =>
                popoverOpen ? setPopoverOpen(false) : openPopover()
              }
              className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-blue-900/30 dark:text-blue-300"
            >
              {t("measureTypes.stagesPopover", { count: stages.length })}
            </button>
            {popoverOpen &&
              createPortal(
                <div
                  role="list"
                  aria-label={`${mt.name} stages`}
                  style={{
                    position: "fixed",
                    top: popoverPos.top,
                    left: popoverPos.left,
                    zIndex: 9999,
                  }}
                  className="w-64 rounded-lg border border-gray-200 bg-white py-2 shadow-xl dark:border-gray-700 dark:bg-gray-900"
                >
                  <p className="px-3 pb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {mt.name} — stages
                  </p>
                  {stages.map((s, i) => (
                    <div
                      key={s.id}
                      role="listitem"
                      className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300"
                    >
                      <span className="mr-1.5 text-gray-400">{i + 1}.</span>
                      {s.name.plainLanguage}
                    </div>
                  ))}
                </div>,
                document.body,
              )}
          </>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    </tr>
  );
}
