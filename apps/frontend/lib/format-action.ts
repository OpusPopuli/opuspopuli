/**
 * Format a LegislativeAction into a one-line summary suitable for an
 * activity-feed card. The mapping is defensive — if an action lacks
 * the fields the per-type template expects, we fall back to a
 * generic "{actionType}: {rawSubject}" so nothing renders as blank.
 *
 * Issue #665.
 */

import type { LegislativeAction } from "@/lib/graphql/region";

const PUNCH_BY_TYPE: Record<string, string> = {
  presence: "Attendance",
  committee_hearing: "Committee hearing",
  committee_report: "Committee report",
  amendment: "Amendment",
  engrossment: "Bill engrossed",
  enrollment: "Bill enrolled",
  resolution: "Resolution introduced",
  vote: "Floor vote",
  speech: "Floor speech",
};

export function formatActionTitle(action: LegislativeAction): string {
  const subject = action.rawSubject?.trim() ?? "";
  switch (action.actionType) {
    case "presence":
      if (action.position === "absent") {
        return subject ? `Absent — ${subject}` : "Absent from session";
      }
      return subject ? `Present — ${subject}` : "Present at rollcall";
    case "committee_hearing":
      return subject ? `Hearing: Committee on ${subject}` : "Committee hearing";
    case "committee_report":
      return subject ? `Committee reported ${subject}` : "Committee report";
    case "amendment":
      return subject ? `Amendment to ${subject}` : "Amendment";
    case "engrossment":
      return subject ? `${subject} engrossed` : "Bill engrossed";
    case "enrollment":
      return subject ? `${subject} enrolled` : "Bill enrolled";
    case "resolution":
      return subject ? `Introduced ${subject}` : "Resolution introduced";
    case "vote":
      return subject ? `Voted on ${subject}` : "Floor vote";
    case "speech":
      return "Floor speech";
    default:
      return subject ? `${action.actionType}: ${subject}` : action.actionType;
  }
}

/** A short type-label suitable for a colored badge on the card. */
export function formatActionTypeLabel(actionType: string): string {
  return PUNCH_BY_TYPE[actionType] ?? actionType;
}

/** Tailwind-friendly accent class per action type. Stable across renders. */
export function actionTypeAccentClass(actionType: string): string {
  switch (actionType) {
    case "amendment":
      return "bg-amber-100 text-amber-800";
    case "committee_hearing":
      return "bg-blue-100 text-blue-800";
    case "committee_report":
      return "bg-indigo-100 text-indigo-800";
    case "engrossment":
    case "enrollment":
      return "bg-emerald-100 text-emerald-800";
    case "resolution":
      return "bg-purple-100 text-purple-800";
    case "presence":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

/** Compact one-line excerpt of the action's stored text, capped. */
export function formatActionExcerpt(
  action: LegislativeAction,
  maxLength = 140,
): string | undefined {
  const text = action.text?.replaceAll(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + "…";
}
