"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type {
  Representative,
  UserJurisdictionData,
} from "@/lib/graphql/region";
import { findByType, findState, stateSeatSummary } from "@/lib/region-stack";
import { LayerCard, formatWindowCount } from "./LayerCard";

export interface JurisdictionStackProps {
  readonly jurisdictions: readonly UserJurisdictionData[];
  /** Server-filtered to the reader's district where one resolved (#1136). */
  readonly supervisors: readonly Representative[];
  /** The reader's own Assembly and Senate members. */
  readonly legislators: readonly Representative[];
  /** Bills touched in the trailing window; null when we cannot count. */
  readonly stateCount: number | null;
  readonly stateCountCapped?: boolean;
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
  legislators,
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
                <Link
                  href={`/region/representatives/${seat.id}`}
                  prefetch={false}
                  className="font-semibold text-content underline decoration-line underline-offset-2 hover:decoration-accent"
                >
                  {seat.district
                    ? t("stack.county.seatValue", {
                        district: seat.district,
                        name: seat.name,
                      })
                    : seat.name}
                </Link>
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
          seat={
            legislators.length > 0 ? (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-content-dim">
                  {t("layer.state.yourSeats")}
                </span>
                {legislators.map((rep) => (
                  <Link
                    key={rep.id}
                    href={`/region/representatives/${rep.id}`}
                    prefetch={false}
                    className="font-semibold text-content underline decoration-line underline-offset-2 hover:decoration-accent"
                  >
                    {t("layer.state.seatValue", {
                      chamber: rep.chamber,
                      district: rep.district,
                      name: rep.name,
                    })}
                  </Link>
                ))}
              </span>
            ) : null
          }
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
          name={t("layer.federal.title")}
          subtitle={t("layer.federal.meta", {
            district: federal.jurisdiction.name,
          })}
          href="/region/federal"
          count={null}
          countUnavailableLabel={t("stack.count.unavailable")}
          openLabel={t("stack.open")}
        />
      )}
    </div>
  );
}
