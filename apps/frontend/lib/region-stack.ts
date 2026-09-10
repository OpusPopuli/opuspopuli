import type {
  UserJurisdictionData,
  JurisdictionType,
} from "@/lib/graphql/region";

/**
 * The three governments the stack renders, smallest first.
 *
 * Uppercase to match the GraphQL JurisdictionLevel enum this is derived
 * from. Routes and translation keys take `levelSlug()` rather than carrying
 * a second lowercase union — two spellings of the same three values is how
 * they drift apart.
 */
export type StackLevel = "COUNTY" | "STATE" | "FEDERAL";

/** "COUNTY" -> "county", for `/region/{slug}` and `stack.levels.{slug}`. */
export function levelSlug(level: StackLevel): string {
  return level.toLowerCase();
}

/** Meeting `body` values that belong to a county board, not the legislature. */
export const COUNTY_MEETING_BODY = "Board of Supervisors";

/**
 * `representatives.chamber` for a county supervisor. Spelled the same as
 * COUNTY_MEETING_BODY but kept separate on purpose: one describes a meeting
 * row, the other a roster row, and nothing guarantees they stay in step.
 */
export const COUNTY_BOARD_CHAMBER = "Board of Supervisors";

export function findByType(
  jurisdictions: readonly UserJurisdictionData[],
  type: JurisdictionType,
): UserJurisdictionData | undefined {
  return jurisdictions.find((j) => j.jurisdiction.type === type);
}

/**
 * The state the reader lives in.
 *
 * `user_jurisdictions` never carries a STATE row — resolution is
 * point-in-polygon and no statewide boundary is loaded — so this derives it
 * from a district's parent, preferring a real STATE row if one resolves.
 */
export function findState(
  jurisdictions: readonly UserJurisdictionData[],
): { id: string; name: string } | undefined {
  const direct = findByType(jurisdictions, "STATE");
  if (direct) return direct.jurisdiction;
  for (const entry of jurisdictions) {
    const parent = entry.jurisdiction.parent;
    if (parent?.type === "STATE") return { id: parent.id, name: parent.name };
  }
  return undefined;
}

/** "Assembly District 10 · Senate District 02", from whichever resolved. */
export function stateSeatSummary(
  jurisdictions: readonly UserJurisdictionData[],
): string | null {
  const parts = [
    findByType(jurisdictions, "STATE_ASSEMBLY_DISTRICT"),
    findByType(jurisdictions, "STATE_SENATE_DISTRICT"),
  ]
    .filter((j): j is UserJurisdictionData => Boolean(j))
    .map((j) => j.jurisdiction.name);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Items whose date falls inside the trailing window. */
export function countInWindow(
  dates: readonly (string | null | undefined)[],
  now: number,
  windowDays: number,
): number {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  return dates.filter((d) => {
    if (!d) return false;
    const t = Date.parse(d);
    return !Number.isNaN(t) && t >= cutoff;
  }).length;
}

export const WINDOW_DAYS = 7;
export const COUNT_PROBE_SIZE = 25;

/**
 * The bare district number out of a jurisdiction name — "California State
 * Assembly District 2" -> "2".
 *
 * Digits only, on both sides of any comparison, because the roster and the
 * boundary source disagree about zero-padding ("02" vs "2"). That mismatch
 * is the same one #1136 had to defuse for supervisorial districts.
 */
export function districtNumber(name: string | undefined): string | undefined {
  const match = /(\d+)\s*$/.exec(name ?? "");
  return match ? String(Number(match[1])) : undefined;
}
