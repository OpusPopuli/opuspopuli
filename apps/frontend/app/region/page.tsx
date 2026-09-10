"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_BILLS,
  MY_COUNTY_SUPERVISORS,
  MY_JURISDICTIONS,
  type BillsData,
  type MyCountySupervisorsData,
  type MyJurisdictionsData,
} from "@/lib/graphql/region";
import { JurisdictionStack } from "@/components/region/JurisdictionStack";
import { useStateLegislators } from "@/lib/hooks/useStateLegislators";
import { ErrorState, LoadingSkeleton } from "@/components/region/ListStates";

/**
 * Trailing window for the "this week" counts.
 *
 * Deliberately a fixed window rather than "since your last visit": no
 * last-visit timestamp exists anywhere in the codebase, so that framing
 * would need a new column, a write on every page view, and a privacy note
 * for a new per-user behavioural record. Decided 2026-09-09 (#1194).
 */
const WINDOW_DAYS = 7;

/**
 * Page size for the count probe. Counting client-side off an existing
 * date-ordered query keeps this story free of a new resolver or aggregate;
 * the cost is that a busier week than this saturates the page, which the
 * "N+" rendering states rather than hides.
 */
const COUNT_PROBE_SIZE = 25;

/** Bills whose last action falls inside the window. */
function countInWindow(
  dates: readonly (string | null | undefined)[],
  now: number,
): number {
  const cutoff = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return dates.filter((d) => {
    if (!d) return false;
    const t = Date.parse(d);
    return !Number.isNaN(t) && t >= cutoff;
  }).length;
}

/**
 * "Where you live" — the three governments that claim the reader's address
 * (#1194, epic #1193).
 *
 * Replaces the five-card California directory. Those five destinations are
 * not lost: they move wholesale onto the state layer page (#1196), which is
 * why nothing here links to them directly.
 *
 * Counts are honest per level rather than uniform. Only the state card
 * carries one today: `meetings` has no jurisdiction filter (#1139), so any
 * county number would be a state/county mix presented as a county fact, and
 * there is no federal corpus to count. Both render "not counted yet", which
 * is a different sentence from zero.
 */
export default function RegionPage() {
  const { t } = useTranslation("region");

  const {
    data: jurisdictionData,
    loading: jurisdictionsLoading,
    error: jurisdictionsError,
  } = useQuery<MyJurisdictionsData>(MY_JURISDICTIONS);

  const { data: supervisorData } = useQuery<MyCountySupervisorsData>(
    MY_COUNTY_SUPERVISORS,
  );

  const { data: billData, error: billError } = useQuery<BillsData>(GET_BILLS, {
    variables: { take: COUNT_PROBE_SIZE },
  });

  // Captured once per mount rather than read during render: `Date.now()`
  // in a render path is impure (react-hooks/purity) and would re-derive the
  // window on every re-render. The boundary is seven days wide, so
  // mount-time precision is ample.
  const [now] = useState(() => Date.now());

  const legislators = useStateLegislators(
    jurisdictionData?.myJurisdictions ?? [],
  );

  const stateCount = useMemo(() => {
    // A failed probe is "we could not count", never zero.
    if (billError || !billData?.bills) return null;
    return countInWindow(
      billData.bills.items.map((b) => b.lastActionDate),
      now,
    );
  }, [billData, billError, now]);

  const stateCountCapped =
    stateCount !== null && billData?.bills?.items.length === COUNT_PROBE_SIZE;

  if (jurisdictionsLoading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={3} height="h-20" />
      </div>
    );
  }

  if (jurisdictionsError) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <ErrorState entity={t("stack.entity")} />
      </div>
    );
  }

  const jurisdictions = jurisdictionData?.myJurisdictions ?? [];

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <h1 className="font-serif text-3xl text-content">{t("stack.title")}</h1>
      {/* The ordering is smallest-first, which fights the way every map and
          every mailing address is written. Saying so costs one line and
          saves the reader deciding the page is broken. */}
      <p className="mt-2 max-w-xl text-content-dim">{t("stack.subtitle")}</p>

      <div className="mt-8">
        {jurisdictions.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface p-6">
            <p className="font-semibold text-content">
              {t("stack.noAddress.title")}
            </p>
            <p className="mt-1 text-sm text-content-dim">
              {t("stack.noAddress.body")}
            </p>
          </div>
        ) : (
          <JurisdictionStack
            jurisdictions={jurisdictions}
            supervisors={supervisorData?.myCountySupervisors ?? []}
            legislators={legislators}
            stateCount={stateCount}
            stateCountCapped={stateCountCapped}
          />
        )}
      </div>
    </div>
  );
}
