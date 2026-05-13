"use client";

import { useState } from "react";
import type { CivicsLifecycleStage, CitizenAction } from "@/lib/graphql/region";

interface LifecycleProgressBarProps {
  stages: CivicsLifecycleStage[];
  /**
   * The `id` of the current stage. Pass `null` for "abstract" mode
   * (used on the how-it-works hub) where no stage is highlighted.
   */
  currentStageId: string | null;
}

const urgencyColors: Record<CitizenAction["urgency"], string> = {
  active:
    "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300",
  passive:
    "bg-gray-50 border-gray-200 text-gray-600 dark:bg-gray-800/50 dark:border-gray-700 dark:text-gray-400",
  none: "hidden",
};

function getStepDotClass(
  isSelected: boolean,
  isAbstract: boolean,
  isCompleted: boolean,
  isCurrent: boolean,
): string {
  if (isSelected) return "scale-110 border-blue-700 bg-blue-700 shadow-md";
  if (isAbstract)
    return "border-gray-400 bg-white hover:border-blue-400 dark:border-gray-500 dark:bg-gray-800";
  if (isCompleted) return "border-blue-500 bg-blue-500";
  if (isCurrent) return "border-blue-600 bg-blue-600 ring-2 ring-blue-300";
  return "border-gray-300 bg-white hover:border-blue-400 dark:border-gray-600 dark:bg-gray-900";
}

function getStageLabelClass(
  isSelected: boolean,
  isCompleted: boolean,
  isCurrent: boolean,
): string {
  if (isSelected || isCurrent)
    return "font-semibold text-blue-700 dark:text-blue-400";
  if (isCompleted) return "text-gray-400 dark:text-gray-500";
  return "text-gray-500 dark:text-gray-400";
}

/**
 * Horizontal step indicator for a bill's lifecycle.
 *
 * In bill-detail mode: completed stages dimmed, current highlighted, future outlined.
 * In abstract mode (currentStageId === null): all stages shown equally.
 * Clicking a stage dot expands a detail panel below the bar.
 */
export function LifecycleProgressBar({
  stages,
  currentStageId,
}: LifecycleProgressBarProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (stages.length === 0) return null;

  const currentIdx = currentStageId
    ? stages.findIndex((s) => s.id === currentStageId)
    : -1;

  const selectedStage = stages.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <nav aria-label="Bill lifecycle stages">
        <ol
          role="list"
          className="flex items-start gap-1 overflow-x-auto pb-1 text-xs"
        >
          {stages.map((stage, idx) => {
            const isCompleted = currentIdx >= 0 && idx < currentIdx;
            const isCurrent = idx === currentIdx;
            const isAbstract = currentStageId === null;
            const isSelected = selectedId === stage.id;

            return (
              <li
                key={stage.id}
                role="listitem"
                aria-current={isCurrent ? "step" : undefined}
                className="group relative flex min-w-[4rem] flex-1 flex-col items-center"
              >
                {/* Connector line */}
                {idx < stages.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={[
                      "absolute left-1/2 top-3 h-0.5 w-full",
                      isCompleted
                        ? "bg-blue-500"
                        : "bg-gray-200 dark:bg-gray-700",
                    ].join(" ")}
                  />
                )}

                {/* Step dot — click to select */}
                <button
                  type="button"
                  tabIndex={0}
                  onClick={() =>
                    setSelectedId((prev) =>
                      prev === stage.id ? null : stage.id,
                    )
                  }
                  aria-pressed={isSelected}
                  aria-label={`${stage.name.plainLanguage}: ${stage.shortDescription.plainLanguage}`}
                  className={[
                    "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                    getStepDotClass(
                      isSelected,
                      isAbstract,
                      isCompleted,
                      isCurrent,
                    ),
                  ].join(" ")}
                >
                  {isCompleted && !isSelected && (
                    <svg
                      aria-hidden="true"
                      className="h-3 w-3 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-white"
                    />
                  )}
                </button>

                {/* Stage label — click handled by button above; span is display only */}
                <span
                  aria-hidden="true"
                  className={[
                    "mt-1 max-w-[5rem] text-center leading-tight",
                    getStageLabelClass(isSelected, isCompleted, isCurrent),
                  ].join(" ")}
                >
                  {stage.name.plainLanguage}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Expanded detail panel for selected stage */}
      {selectedStage && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/10">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-blue-900 dark:text-blue-200">
              {selectedStage.name.plainLanguage}
            </h4>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close stage detail"
              className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
            >
              ✕
            </button>
          </div>

          <p className="mt-1 text-sm text-blue-800 dark:text-blue-300">
            {selectedStage.shortDescription.plainLanguage}
          </p>

          {selectedStage.longDescription && (
            <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {selectedStage.longDescription.plainLanguage}
            </p>
          )}

          {selectedStage.citizenAction &&
            selectedStage.citizenAction.urgency !== "none" && (
              <div
                className={[
                  "mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                  urgencyColors[selectedStage.citizenAction.urgency],
                ].join(" ")}
              >
                <span aria-hidden="true" className="font-medium">
                  {selectedStage.citizenAction.verb === "comment" && "💬"}
                  {selectedStage.citizenAction.verb === "attend" && "📅"}
                  {selectedStage.citizenAction.verb === "contact" && "✉️"}
                  {selectedStage.citizenAction.verb === "monitor" && "👁"}
                  {selectedStage.citizenAction.verb === "vote" && "🗳"}
                  {selectedStage.citizenAction.verb === "learn" && "📖"}
                </span>
                {/* Defense-in-depth: only allow http(s) URLs (primary guard is in backend) */}
                {selectedStage.citizenAction.url &&
                (selectedStage.citizenAction.url.startsWith("https://") ||
                  selectedStage.citizenAction.url.startsWith("http://")) ? (
                  <a
                    href={selectedStage.citizenAction.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    {selectedStage.citizenAction.label.plainLanguage}
                  </a>
                ) : (
                  <span>{selectedStage.citizenAction.label.plainLanguage}</span>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
