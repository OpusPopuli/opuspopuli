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
  active: "bg-warning-surface border-warning-line text-warning",
  passive: "bg-surface-alt border-line text-content-dim ",
  none: "hidden",
};

function getStepDotClass(
  isSelected: boolean,
  isAbstract: boolean,
  isCompleted: boolean,
  isCurrent: boolean,
): string {
  if (isSelected) return "scale-110 border-info-line bg-accent ";
  if (isAbstract) return "border-line bg-surface hover:border-accent ";
  if (isCompleted) return "border-accent bg-accent";
  if (isCurrent) return "border-accent bg-accent ring-2 ring-accent";
  return "border-line bg-surface hover:border-accent ";
}

function getStageLabelClass(
  isSelected: boolean,
  isCompleted: boolean,
  isCurrent: boolean,
): string {
  if (isSelected || isCurrent) return "font-semibold text-info";
  if (isCompleted) return "text-content-dim ";
  return "text-content-dim ";
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
                      isCompleted ? "bg-accent" : "bg-surface-sunk ",
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
                    "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
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
                      className="h-3 w-3 text-paper"
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
                      className="h-2 w-2 rounded-full bg-surface"
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
        <div className="rounded-lg border border-info-line bg-info-surface p-4/50/10">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-info">
              {selectedStage.name.plainLanguage}
            </h4>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close stage detail"
              className="text-info hover:text-info-strong dark:hover:text-info-strong"
            >
              ✕
            </button>
          </div>

          <p className="mt-1 text-sm text-info">
            {selectedStage.shortDescription.plainLanguage}
          </p>

          {selectedStage.longDescription && (
            <p className="mt-2 text-sm leading-relaxed text-content-dim">
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
