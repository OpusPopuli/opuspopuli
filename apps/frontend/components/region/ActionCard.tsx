"use client";

import type { LegislativeAction } from "@/lib/graphql/region";
import { formatDate } from "@/lib/format";
import {
  formatActionTitle,
  formatActionTypeLabel,
  formatActionExcerpt,
  actionTypeAccentClass,
} from "@/lib/format-action";

/**
 * One activity-feed row. Renders a type-coded badge, the
 * one-line title, the date, and (when available) a short excerpt
 * pulled from the action's stored text. Clicking "See passage →"
 * fires `onSeePassage(actionId)` so the parent can open the L4
 * quote panel or expand inline.
 *
 * Issue #665.
 */
export function ActionCard({
  action,
  onSeePassage,
}: {
  readonly action: LegislativeAction;
  readonly onSeePassage?: (actionId: string) => void;
}) {
  const title = formatActionTitle(action);
  const typeLabel = formatActionTypeLabel(action.actionType);
  const accent = actionTypeAccentClass(action.actionType);
  const excerpt = formatActionExcerpt(action);
  const hasPassageOffsets =
    typeof action.passageStart === "number" &&
    typeof action.passageEnd === "number";

  return (
    <article className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${accent}`}
            >
              {typeLabel}
            </span>
            <time dateTime={action.date} className="text-xs text-[#595959]">
              {formatDate(action.date)}
            </time>
          </div>
          <p className="font-medium text-[#222222]">{title}</p>
          {excerpt && (
            <p className="mt-1.5 text-sm text-[#4d4d4d] leading-relaxed">
              {excerpt}
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
