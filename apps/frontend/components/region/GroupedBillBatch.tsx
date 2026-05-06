"use client";

import type { LegislativeAction } from "@/lib/graphql/region";
import { formatDate } from "@/lib/format";
import {
  formatActionTypeLabel,
  actionTypeAccentClass,
} from "@/lib/format-action";

/**
 * Renders a run of consecutive same-day-same-verdict actions as a
 * single card with bill chips. Used for engrossment / enrollment /
 * committee_report blocks where the source journal lists N bills
 * under one disposition.
 *
 * Each bill chip is clickable — fires `onSeePassage(actionId)` for
 * the underlying action so the citation flow still works on a
 * per-bill basis. The batch header shows the verdict text once
 * (e.g. "Chief Clerk reports engrossed").
 *
 * Issue #665.
 */
export function GroupedBillBatch({
  actionType,
  date,
  verdict,
  actions,
  onSeePassage,
}: {
  readonly actionType: string;
  readonly date: string;
  readonly verdict: string;
  readonly actions: readonly LegislativeAction[];
  readonly onSeePassage?: (actionId: string) => void;
}) {
  const typeLabel = formatActionTypeLabel(actionType);
  const accent = actionTypeAccentClass(actionType);
  // Title-case the verdict for display since we lowercased it for hashing.
  const verdictDisplay =
    verdict.length > 0
      ? verdict.charAt(0).toUpperCase() + verdict.slice(1)
      : "Recorded";

  return (
    <article className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${accent}`}
        >
          {typeLabel}
        </span>
        <time dateTime={date} className="text-xs text-[#595959]">
          {formatDate(date)}
        </time>
        <span className="text-xs text-[#595959]">·</span>
        <span className="text-xs font-medium text-[#595959]">
          {actions.length} bills
        </span>
      </div>

      <p className="font-medium text-[#222222] mb-3">{verdictDisplay}</p>

      <ul className="flex flex-wrap gap-1.5" aria-label="Bills in this batch">
        {actions.map((a) => {
          const label = a.rawSubject ?? "Bill";
          const hasPassage =
            typeof a.passageStart === "number" &&
            typeof a.passageEnd === "number";
          if (hasPassage && onSeePassage) {
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onSeePassage(a.id)}
                  className="inline-flex items-center px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-[#334155] hover:bg-slate-100 hover:border-slate-300 transition-colors"
                  title="See source passage"
                >
                  {label}
                </button>
              </li>
            );
          }
          return (
            <li key={a.id}>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-[#334155]">
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
