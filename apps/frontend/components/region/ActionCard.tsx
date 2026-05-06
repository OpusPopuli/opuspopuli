"use client";

import type { LegislativeAction } from "@/lib/graphql/region";
import { formatDate } from "@/lib/format";
import {
  formatActionTitle,
  formatActionTypeLabel,
  actionTypeAccentClass,
} from "@/lib/format-action";

/**
 * One activity-feed row. Renders a type-coded badge, the date,
 * the one-line title, and (when available) the full verbatim
 * passage stored on the action. The text column is capped at 4kB
 * server-side already; rendering inline avoids the
 * "click-to-expand-once-per-card" friction users hit when there
 * are dozens of passages on a committee L3 — the column is
 * scannable and citation-quotable as-is.
 *
 * Clicking "See passage →" (Phase 3) opens the source-document
 * viewer with surrounding context.
 *
 * Issue #665.
 */
export function ActionCard({
  action,
  onSeePassage,
  compact = false,
}: {
  readonly action: LegislativeAction;
  readonly onSeePassage?: (actionId: string) => void;
  /** When true, drop the type badge + date — used by GroupedBillBatch
   *  where the batch header already shows them. */
  readonly compact?: boolean;
}) {
  const title = formatActionTitle(action);
  const typeLabel = formatActionTypeLabel(action.actionType);
  const accent = actionTypeAccentClass(action.actionType);
  const hasPassageOffsets =
    typeof action.passageStart === "number" &&
    typeof action.passageEnd === "number";

  return (
    <article className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {!compact && (
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${accent}`}
              >
                {typeLabel}
              </span>
              <time dateTime={action.date} className="text-xs text-[#595959]">
                {formatDate(action.date)}
              </time>
            </div>
          )}
          <p className="font-medium text-[#222222]">{title}</p>
          {action.text && (
            <p className="mt-2 text-sm text-[#4d4d4d] leading-relaxed whitespace-pre-line">
              {action.text}
            </p>
          )}
        </div>
        {hasPassageOffsets && onSeePassage && (
          <button
            type="button"
            onClick={() => onSeePassage(action.id)}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
          >
            See passage →
          </button>
        )}
      </div>
    </article>
  );
}
