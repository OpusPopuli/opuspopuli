"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { GET_BILLS, type BillsData } from "@/lib/graphql/region";
import { JurisdictionStack } from "@/components/region/JurisdictionStack";
import { useJurisdictions } from "@/components/region/JurisdictionsContext";
import { NoLocationState } from "@/components/region/NoLocationState";
import {
  COUNT_PROBE_SIZE,
  WINDOW_DAYS,
  countInWindow,
} from "@/lib/region-stack";
import { useStateLegislators } from "@/lib/hooks/useStateLegislators";
import { useCountySupervisors } from "@/lib/hooks/useCountySupervisors";
import { VisitorLocationControl } from "@/components/region/LocateForm";
import { ErrorState, LoadingSkeleton } from "@/components/region/ListStates";

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
    jurisdictions,
    loading: jurisdictionsLoading,
    error: jurisdictionsError,
    source,
  } = useJurisdictions();

  const supervisors = useCountySupervisors();

  const { data: billData, error: billError } = useQuery<BillsData>(GET_BILLS, {
    variables: { take: COUNT_PROBE_SIZE },
  });

  // Captured once per mount rather than read during render: `Date.now()`
  // in a render path is impure (react-hooks/purity) and would re-derive the
  // window on every re-render. The boundary is seven days wide, so
  // mount-time precision is ample.
  const [now] = useState(() => Date.now());

  const legislators = useStateLegislators(jurisdictions);

  const stateCount = useMemo(() => {
    // A failed probe is "we could not count", never zero.
    if (billError || !billData?.bills) return null;
    return countInWindow(
      billData.bills.items.map((b) => b.lastActionDate),
      now,
      WINDOW_DAYS,
    );
  }, [billData, billError, now]);

  // Capped when the WINDOW is full, not when the PAGE is. The list is
  // date-descending, so once a row falls outside the window no later row
  // can be inside it — a full page therefore says nothing about
  // saturation. Testing page length rendered "0+ this week" whenever 25
  // rows came back and none of them were recent.
  const stateCountCapped = stateCount === COUNT_PROBE_SIZE;

  if (jurisdictionsLoading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={3} height="h-20" />
      </div>
    );
  }

  // Signed in, a failed read of the account's districts is an error to
  // show. A visitor's saved location failing to load (a 429, a gateway
  // blip) falls through to the lookup form instead, as on the other region
  // pages, so they're never stuck without a way to set or change it.
  if (jurisdictionsError && source !== "device") {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <ErrorState entity={t("stack.entity")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <h1 className="font-serif text-3xl text-content">{t("stack.title")}</h1>
      {/* The ordering is smallest-first, which fights the way every map and
          every mailing address is written. Saying so costs one line and
          saves the reader deciding the page is broken. */}
      <p className="mt-2 max-w-xl text-content-dim">{t("stack.subtitle")}</p>

      <div className="mt-8">
        {jurisdictions.length === 0 && <NoLocationState framed />}
        {jurisdictions.length > 0 && (
          <JurisdictionStack
            jurisdictions={jurisdictions}
            supervisors={supervisors}
            legislators={legislators}
            stateCount={stateCount}
            stateCountCapped={stateCountCapped}
            showWrongSeat={source === "account"}
          />
        )}
        <VisitorLocationControl />
      </div>
    </div>
  );
}
