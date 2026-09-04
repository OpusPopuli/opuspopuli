"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { Trans } from "react-i18next";
import {
  GET_COUNTY_THRESHOLDS,
  type CountyThresholdsData,
} from "@/lib/graphql/counties";
import { CountyRail } from "./CountyRail";
import { MapModeToggle, type MapMode } from "./MapModeToggle";

/**
 * MapLibre touches `window` at construction, so the map cannot render on the
 * server — `ssr: false` is required for the build, not an optimisation.
 *
 * It also keeps ~400-450KB of MapLibre and deck.gl out of the route's initial
 * JS. #1111 takes that further with a pre-rendered snapshot so the first paint
 * does not wait on the bundle at all.
 */
const CountyMap = dynamic(
  () => import("./CountyMap").then((m) => m.CountyMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full w-full animate-pulse rounded-lg bg-slate-800"
        aria-hidden="true"
      />
    ),
  },
);

const STATUTE_URL =
  "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=ELEC&sectionNum=9118";

/**
 * The county threshold section: map, mode toggle, rail, and the footnote.
 *
 * Public records only. Nothing here reads user, signup or activation data
 * (#1105 criterion 9) — the section works with no session, which is the point.
 */
export function CountyThresholds() {
  const { t } = useTranslation("landing");
  const [mode, setMode] = useState<MapMode>("share");
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const { data, loading, error } = useQuery<CountyThresholdsData>(
    GET_COUNTY_THRESHOLDS,
  );

  const counties = useMemo(
    () => data?.countyThresholds ?? [],
    [data?.countyThresholds],
  );
  const selected = useMemo(
    () => counties.find((c) => c.fips === selectedFips) ?? null,
    [counties, selectedFips],
  );

  // A failed query must not render an empty map that looks like "no counties
  // qualify". Say nothing rather than something false.
  if (error) return null;

  return (
    <section
      className="mx-auto max-w-6xl px-8 py-20"
      aria-labelledby="counties-heading"
    >
      <h2 id="counties-heading" className="text-2xl font-bold text-content">
        {t("counties.heading")}
      </h2>
      <p className="mt-3 max-w-3xl text-content-dim">{t("counties.intro")}</p>

      <MapModeToggle value={mode} onChange={setMode} className="mt-8" />

      <div className="mt-6 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="h-[420px] overflow-hidden rounded-lg bg-slate-900">
          {!loading && counties.length > 0 && (
            <CountyMap
              counties={counties}
              mode={mode}
              selectedFips={selectedFips}
              onSelect={setSelectedFips}
              reducedMotion={reducedMotion}
              className="h-full w-full"
            />
          )}
        </div>

        <CountyRail county={selected} onSelectFips={setSelectedFips} />
      </div>

      <div className="mt-12 max-w-3xl">
        <h3 className="text-lg font-semibold text-content">
          {t("counties.framing.heading")}
        </h3>
        <p className="mt-2 text-content-dim">{t("counties.framing.body")}</p>
      </div>

      <div className="mt-10 max-w-3xl">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-content-dim">
          {t("counties.footnote.heading")}
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-content-dim">
          <li>
            {/* The statute is cited inline where the 10% figure is explained,
                and linked, because "trust us" is not what this page is for. */}
            <Trans
              i18nKey="counties.footnote.statute"
              ns="landing"
              components={[
                <a
                  key="statute"
                  href={STATUTE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-sky-300"
                />,
              ]}
            />
          </li>
          <li>{t("counties.footnote.specialElection")}</li>
          <li>{t("counties.footnote.notPassing")}</li>
          <li>{t("counties.footnote.cities")}</li>
          <li>{t("counties.footnote.verify")}</li>
        </ul>
      </div>
    </section>
  );
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the reader has asked for less motion.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: matchMedia
 * IS an external store, and reading it through an effect means rendering once
 * with the wrong answer and again with the right one. The server snapshot
 * returns false because `window.matchMedia` does not exist during SSR.
 *
 * Read here rather than inside the map, so the map stays a pure component and
 * the media query has exactly one owner.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}
