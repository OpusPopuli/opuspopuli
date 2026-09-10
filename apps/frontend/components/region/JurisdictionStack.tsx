"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type {
  JurisdictionType,
  Representative,
  UserJurisdictionData,
} from "@/lib/graphql/region";
import { LayerCard, formatWindowCount } from "./LayerCard";

export interface JurisdictionStackProps {
  readonly jurisdictions: readonly UserJurisdictionData[];
  /** Server-filtered to the reader's district where one resolved (#1136). */
  readonly supervisors: readonly Representative[];
  /** Bills touched in the trailing window; null when we cannot count. */
  readonly stateCount: number | null;
  readonly stateCountCapped?: boolean;
}

function findByType(
  jurisdictions: readonly UserJurisdictionData[],
  type: JurisdictionType,
): UserJurisdictionData | undefined {
  return jurisdictions.find((j) => j.jurisdiction.type === type);
}

/**
 * The state the reader lives in.
 *
 * Jurisdictions are resolved by point-in-polygon against loaded boundaries,
 * and no statewide boundary is loaded — so `user_jurisdictions` never
 * contains a STATE row, only the districts inside it. Reading the state off
 * `type === "STATE"` therefore found nothing and dropped the whole state
 * card, which is where nearly all of today's data lives.
 *
 * The district rows carry `parent: { type: STATE, name: "California" }`, and
 * MY_JURISDICTIONS already selects it. Prefer a real STATE row if one ever
 * resolves; otherwise derive it from a district's parent.
 */
function findState(
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

/** "Assembly D-10 · Senate D-02", from whichever of the two resolved. */
function stateSeatSummary(
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

/**
 * The three governments that claim the reader's address (#1194).
 *
 * Smallest first — county, state, federal. The ordering is deliberate and
 * fights containment intuition (maps and addresses go big to small), which
 * is why the page subhead says so in words.
 *
 * The city is deliberately absent: it is the smallest unit and probably
 * where a reader has the most leverage per signature, which is exactly why
 * it is omitted rather than stubbed — a permanent "Building" row on the
 * highest-leverage government advertises the gap on every page load. It
 * returns as a fourth card the day there is something behind it.
 */
export function JurisdictionStack({
  jurisdictions,
  supervisors,
  stateCount,
  stateCountCapped,
}: JurisdictionStackProps) {
  const { t } = useTranslation("region");

  const county = findByType(jurisdictions, "COUNTY");
  const state = findState(jurisdictions);
  const federal = findByType(jurisdictions, "CONGRESSIONAL_DISTRICT");

  // The supervisorial district is not a layer — it is one of five seats on
  // one board, and there is no district-level petition (§9118 is
  // county-wide). It renders inside the county card.
  //
  // #1136: myCountySupervisors returns the whole board when no
  // supervisorial boundary resolved, which is true for 57 of 58 counties
  // today. Exactly one supervisor means the district resolved; anything
  // else means it did not, and the seat line is omitted rather than
  // guessing which of five seats is the reader's.
  const seatResolved = supervisors.length === 1;
  const seat = seatResolved ? supervisors[0] : null;

  return (
    <div className="space-y-3">
      {county && (
        <LayerCard
          level="COUNTY"
          levelLabel={t("stack.levels.county")}
          name={county.jurisdiction.name}
          subtitle={supervisors.length > 0 ? t("stack.county.board") : null}
          href="/region/county"
          count={null}
          countUnavailableLabel={t("stack.count.unavailable")}
          openLabel={t("stack.open")}
          seat={
            seat ? (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-content-dim">
                  {t("stack.county.yourSeat")}
                </span>
                <span className="font-semibold text-content">
                  {seat.district
                    ? t("stack.county.seatValue", {
                        district: seat.district,
                        name: seat.name,
                      })
                    : seat.name}
                </span>
                <Link
                  href="/settings"
                  className="text-content-dim underline decoration-line underline-offset-2 hover:decoration-accent"
                >
                  {t("stack.county.wrongSeat")}
                </Link>
              </span>
            ) : null
          }
        />
      )}

      {state && (
        <LayerCard
          level="STATE"
          levelLabel={t("stack.levels.state")}
          name={state.name}
          subtitle={stateSeatSummary(jurisdictions)}
          href="/region/state"
          count={stateCount}
          countCapped={stateCountCapped}
          countLabel={
            stateCount === null
              ? undefined
              : // `value`, not `count`: i18next reserves `count` for plural
                // resolution, and "25+" is a string, so passing it there
                // silently picks the wrong plural form.
                t("stack.count.thisWeek", {
                  value: formatWindowCount(stateCount, stateCountCapped),
                })
          }
          countUnavailableLabel={t("stack.count.unavailable")}
          openLabel={t("stack.open")}
        />
      )}

      {federal && (
        <LayerCard
          level="FEDERAL"
          levelLabel={t("stack.levels.federal")}
          name={federal.jurisdiction.name}
          subtitle={t("stack.federal.subtitle")}
          href="/region/federal"
          count={null}
          countUnavailableLabel={t("stack.count.unavailable")}
          openLabel={t("stack.open")}
        />
      )}
    </div>
  );
}
