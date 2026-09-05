"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_COUNTY_THRESHOLDS,
  type CountyThreshold,
  type CountyThresholdsData,
} from "@/lib/graphql/counties";
import { GET_MY_ADDRESSES, type MyAddressesData } from "@/lib/graphql/profile";
import { findByCountyName } from "@/lib/county-name";
import { CountyRail } from "@/components/landing/CountyRail";
import { pickExistingAddress } from "./AddressStep";

interface ThresholdStepProps {
  readonly onComplete: () => void;
  /** Sends the reader back to the address form when the county is wrong. */
  readonly onCorrect: () => void;
}

/** Geocoding is asynchronous, so poll briefly rather than give up at once. */
const POLL_MS = 1500;
const POLL_LIMIT = 8;

/**
 * Step 2: what it takes, for the reader's own county.
 *
 * This step exists to pay for step 1. The address was just handed over; this
 * returns a specific, checkable number about the place the reader lives,
 * before anything else is asked of them.
 *
 * The ledger is `CountyRail`, the same component the landing page uses. The
 * figures, their formatting, the source link and the "every value the map
 * encodes in colour is also a number" guarantee all live in one place, so this
 * screen cannot drift from the page that made the promise.
 */
export function ThresholdStep({ onComplete, onCorrect }: ThresholdStepProps) {
  const { t } = useTranslation("onboarding");

  const { data: thresholdData } = useQuery<CountyThresholdsData>(
    GET_COUNTY_THRESHOLDS,
  );
  // Geocoding is asynchronous, so the row may still say "pending" when this
  // screen mounts. Poll declaratively rather than through Apollo's imperative
  // start/stopPolling handles: those are extra API surface to depend on, and
  // a caller that stubs useQuery without them takes the component down.
  const [stoppedPolling, setStoppedPolling] = useState(false);
  const { data: addressData } = useQuery<MyAddressesData>(GET_MY_ADDRESSES, {
    fetchPolicy: "cache-and-network",
    pollInterval: stoppedPolling ? 0 : POLL_MS,
  });

  const address = useMemo(
    () => pickExistingAddress(addressData?.myAddresses),
    [addressData?.myAddresses],
  );
  const county = useMemo(
    () =>
      findByCountyName(thresholdData?.countyThresholds ?? [], address?.county),
    [thresholdData?.countyThresholds, address?.county],
  );

  const loaded = Boolean(addressData);
  const pending = address?.civicResolutionStatus === "pending";

  /* eslint-disable react-hooks/set-state-in-effect -- stopping a poll is a
     state change driven by query data resolving; the ceiling below is what
     keeps a permanently-pending row from polling for as long as the tab is
     open. */
  useEffect(() => {
    if (loaded && !pending) {
      setStoppedPolling(true);
      return;
    }
    const id = window.setTimeout(
      () => setStoppedPolling(true),
      POLL_MS * POLL_LIMIT,
    );
    return () => window.clearTimeout(id);
  }, [loaded, pending]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Still pending after the attempts are spent: stop promising a number that
  // is not coming.
  const gaveUp = stoppedPolling && pending;

  return (
    <div className="w-full max-w-md">
      <p className="text-xs font-semibold uppercase tracking-[0.13em] text-content-dim">
        {county
          ? t("progress.stepOfIn", {
              current: 2,
              total: 6,
              county: county.name,
            })
          : t("progress.stepOf", { current: 2, total: 6 })}
      </p>

      {county ? (
        <Resolved county={county} />
      ) : (
        <Unresolved
          waiting={pending && !gaveUp}
          hasAddress={Boolean(address)}
        />
      )}

      <div className="flex items-center justify-between gap-3 pt-6">
        {/* "That is the wrong county" only makes sense once one is named.
            With nothing resolved, the same button is an invitation to supply
            the address rather than a correction to a claim never made. */}
        <button
          type="button"
          onClick={onCorrect}
          className="px-3 py-2 text-sm text-content-dim hover:text-content"
        >
          {t(county ? "threshold.wrongCounty" : "threshold.addAddress")}
        </button>
        <button
          type="button"
          onClick={onComplete}
          className="rounded-full bg-inverse-surface px-8 py-3 font-semibold text-on-inverse transition-colors hover:opacity-90"
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}

function Resolved({ county }: { county: CountyThreshold }) {
  const { t } = useTranslation("onboarding");

  return (
    <>
      {/* The heading makes the claim; the ledger below renders the figure. It
          used to render the numeral too, which put the same number on screen
          twice within 300px of itself. */}
      <h2 className="mt-3 font-serif text-3xl leading-tight text-content">
        {t("threshold.title", { county: county.name })}
      </h2>
      <p className="mt-3 text-content-dim">
        {t("threshold.body", { year: county.gubernatorialYear })}
      </p>

      {/* Reused from the landing page rather than rebuilt: same figures, same
          formatting, same source link. A second copy would drift. */}
      <CountyRail county={county} className="mt-6" />
    </>
  );
}

/**
 * What to say when there is no number to show.
 *
 * Three different reasons land here and they are not interchangeable: the
 * geocoder is still working, the reader skipped the address, or the address
 * resolved to somewhere we have no threshold for (out of state, or a county
 * the sync has not reached). Saying "loading" to the second is a lie, and
 * saying "not found" to the first is one too.
 */
function Unresolved({
  waiting,
  hasAddress,
}: {
  waiting: boolean;
  hasAddress: boolean;
}) {
  const { t } = useTranslation("onboarding");
  const key = (() => {
    if (waiting) return "threshold.waiting";
    if (!hasAddress) return "threshold.noAddress";
    return "threshold.noMatch";
  })();

  return (
    <div className="mt-3">
      <h2 className="font-serif text-2xl leading-tight text-content">
        {t(`${key}Title`)}
      </h2>
      <p className="mt-3 text-content-dim">{t(`${key}Body`)}</p>
    </div>
  );
}
