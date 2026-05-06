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

// ============================================
// Type sub-section grouping (issue #665, content expansion)
// ============================================

/**
 * Order in which we want type sub-sections to appear in an L3
 * activity feed. Higher-signal types (hearings, reports) lead;
 * presence rows (highest volume / lowest signal) sink to the
 * bottom when included.
 */
const TYPE_ORDER: Record<string, number> = {
  committee_hearing: 1,
  committee_report: 2,
  amendment: 3,
  resolution: 4,
  engrossment: 5,
  enrollment: 6,
  vote: 7,
  speech: 8,
  presence: 9,
};

/** Stable position in the L3 feed for a given action type. */
export function actionTypeSortKey(actionType: string): number {
  return TYPE_ORDER[actionType] ?? 99;
}

/**
 * Bucket a flat reverse-chronological action list into ordered
 * `(actionType, items)` groups. Within each group, items keep
 * their date-desc order — the bucket is purely a visual grouping;
 * the underlying chronology isn't reshuffled within a type.
 *
 * Drives type-section sub-headers in the activity feed
 * ("Hearings · 7 records", "Bill reports · 43 records", …).
 */
export interface ActionGroup {
  actionType: string;
  label: string;
  items: LegislativeAction[];
}

export function groupActionsByType(
  actions: readonly LegislativeAction[],
): ActionGroup[] {
  const buckets = new Map<string, LegislativeAction[]>();
  for (const a of actions) {
    const list = buckets.get(a.actionType) ?? [];
    list.push(a);
    buckets.set(a.actionType, list);
  }
  return Array.from(buckets.entries())
    .map(([actionType, items]) => ({
      actionType,
      label: formatActionTypeLabel(actionType),
      items,
    }))
    .sort(
      (a, b) =>
        actionTypeSortKey(a.actionType) - actionTypeSortKey(b.actionType),
    );
}

// ============================================
// Bill-batch grouping (issue #665, content expansion)
// ============================================

/**
 * Within a single section header (e.g. ENGROSSMENT AND ENROLLMENT
 * REPORTS) the journal lists N bills under one disposition. Each
 * bill becomes its own LegislativeAction with the same actionType +
 * date + similar text — so the L3 feed renders as 30 visually
 * identical cards. Worse, this drowns out higher-signal records on
 * the page.
 *
 * `groupBillBatches` collapses runs of consecutive actions sharing
 * `(actionType, date, normalized verdict text)` into a single
 * "batch" entry that can be rendered as one card with N bill chips.
 *
 * Returns a flat list where each entry is either a single action
 * (`type: "single"`) or a batch (`type: "batch"`). The flat shape
 * keeps integration with `groupActionsByType` simple — both
 * single + batch entries belong to the same actionType bucket.
 */
export type FeedEntry =
  | { type: "single"; action: LegislativeAction }
  | {
      type: "batch";
      actionType: string;
      date: string;
      verdict: string;
      actions: LegislativeAction[];
    };

/**
 * Strip the canonical bill citation off the front of a verdict
 * string so two bills under the same recommendation hash to the
 * same key. e.g.
 *   "AB 1897: Chief Clerk reports engrossed."
 *   "AB 2333: Chief Clerk reports engrossed."
 * both reduce to "Chief Clerk reports engrossed.".
 */
function normalizeVerdictKey(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/^[ASJ]?[A-Z]{1,3}\s*\d+\s*[:.]?\s*/i, "")
    .trim()
    .toLowerCase();
}

/** Action types that are worth batching when consecutive. */
const BATCHABLE = new Set([
  "engrossment",
  "enrollment",
  "committee_report",
  "amendment",
]);

export function groupBillBatches(
  actions: readonly LegislativeAction[],
  minBatch = 3,
): FeedEntry[] {
  const out: FeedEntry[] = [];
  let i = 0;
  while (i < actions.length) {
    const a = actions[i];
    if (!BATCHABLE.has(a.actionType)) {
      out.push({ type: "single", action: a });
      i += 1;
      continue;
    }
    const dateKey = a.date.slice(0, 10);
    const verdictKey = normalizeVerdictKey(a.text);
    const run: LegislativeAction[] = [a];
    let j = i + 1;
    while (j < actions.length) {
      const b = actions[j];
      if (
        b.actionType !== a.actionType ||
        b.date.slice(0, 10) !== dateKey ||
        normalizeVerdictKey(b.text) !== verdictKey
      ) {
        break;
      }
      run.push(b);
      j += 1;
    }
    if (run.length >= minBatch) {
      out.push({
        type: "batch",
        actionType: a.actionType,
        date: a.date,
        verdict: verdictKey || "(no recorded verdict)",
        actions: run,
      });
      i = j;
    } else {
      // Not enough to batch — emit each as a single.
      for (const r of run) out.push({ type: "single", action: r });
      i = j;
    }
  }
  return out;
}
