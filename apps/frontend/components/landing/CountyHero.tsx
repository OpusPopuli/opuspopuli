"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { buttonVariants } from "@/components/ui/Button";
import {
  GET_COUNTY_THRESHOLDS,
  type CountyThreshold,
  type CountyThresholdsData,
} from "@/lib/graphql/counties";
import { CountyRail } from "./CountyRail";
import { MapModeToggle, type MapMode } from "./MapModeToggle";

/**
 * MapLibre touches `window` at construction, so the map cannot render on the
 * server: `ssr: false` is required for the build, not an optimisation. It also
 * keeps ~400-450KB of MapLibre and deck.gl out of the route's initial JS.
 * #1111 takes that further with a pre-rendered snapshot so the first paint does
 * not wait on the bundle at all.
 */
const CountyMap = dynamic(
  () => import("./CountyMap").then((m) => m.CountyMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="aspect-[85/100] w-full max-w-[440px] animate-pulse bg-surface-alt/40"
        aria-hidden="true"
      />
    ),
  },
);

/** Sonoma: where this was built, and where a reader who does nothing lands. */
const DEFAULT_FIPS = "06097";
const CYCLE_MS = 5000;

/**
 * The landing hero: the claim and the map on the left, one county's ledger and
 * the way in on the right.
 *
 * Public records only. Nothing here reads user, signup or activation data
 * (#1105 criterion 9) beyond whether a session exists, which decides only
 * whether the map tours and which way the button points.
 */
export function CountyHero() {
  const { t } = useTranslation("landing");
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<MapMode>("share");
  const [selectedFips, setSelectedFips] = useState(DEFAULT_FIPS);
  const [hoveredFips, setHoveredFips] = useState<string | null>(null);
  const [touring, setTouring] = useState(true);

  const { data, error } = useQuery<CountyThresholdsData>(GET_COUNTY_THRESHOLDS);
  const counties = useMemo(
    () => data?.countyThresholds ?? [],
    [data?.countyThresholds],
  );

  // Hover previews without committing, so the pointer can wander the map and
  // the panel keeps up without the reader losing the county they chose.
  const shown = useMemo(
    () => pickShown(counties, hoveredFips ?? selectedFips),
    [counties, hoveredFips, selectedFips],
  );

  const choose = useCallback((fips: string) => {
    // A reader who has picked a county is done being toured.
    setTouring(false);
    setSelectedFips(fips);
  }, []);

  useCountyTour({
    fipsList: counties.map((c) => c.fips),
    startFips: DEFAULT_FIPS,
    // A signed-in reader has a county of their own and does not need to be
    // shown other people's. Held until the session resolves, so a signed-in
    // reader never sees one hop of a tour that should not have started.
    enabled: touring && !authLoading && !isAuthenticated && !reducedMotion,
    paused: hoveredFips !== null,
    onAdvance: setSelectedFips,
  });

  // The map and the ledger are the only things that need the query. The
  // headline, the argument and the way in are not: when the region service is
  // unreachable this page still has to say what it is and let someone sign up.
  // An empty map, though, would read as "no counties qualify", so that half
  // says nothing rather than something false.
  const hasData = !error && counties.length > 0;

  return (
    <section
      className="mx-auto max-w-6xl px-6 pb-16 pt-10 sm:px-8"
      aria-labelledby="counties-heading"
    >
      <div className="grid items-start gap-x-14 gap-y-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:[grid-template-areas:'text_._''map_panel']">
        <div className="lg:[grid-area:text]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-content-dim">
            {t("counties.eyebrow")}
          </p>
          <h1
            id="counties-heading"
            className="mt-3 text-balance font-serif text-[2.1rem] leading-[1.12] text-content sm:text-5xl lg:whitespace-nowrap"
          >
            {t("counties.heading")}
          </h1>
          <p className="mt-4 max-w-[58ch] text-lg leading-relaxed text-content-dim">
            {t("counties.intro")}
          </p>
          <p className="mt-5 text-content-dim">{t("counties.prompt")}</p>
        </div>

        <div className="lg:[grid-area:map]">
          {hasData && (
            <>
              <CountyMap
                counties={counties}
                mode={mode}
                selectedFips={hoveredFips ?? selectedFips}
                onSelect={choose}
                onHover={setHoveredFips}
                reducedMotion={reducedMotion}
              />
              <div className="mt-4 flex max-w-[440px] flex-wrap items-center justify-between gap-4">
                <MapModeToggle value={mode} onChange={setMode} />
                <Legend />
              </div>
            </>
          )}
          {/* Below the map, not above it: the shapes make the claim, and this
              names it. Reading the attribution first asks for agreement before
              showing the reader anything to agree with. */}
          <p className="mt-5 max-w-[58ch] text-sm italic text-content-dim">
            {t("counties.citeMosca")}
          </p>
        </div>

        <div className="flex flex-col gap-8 lg:[grid-area:panel]">
          <HeroCta signedIn={isAuthenticated} loading={authLoading} />
          {hasData && shown && (
            <CountyRail county={shown} onSelectFips={choose} />
          )}
        </div>
      </div>
    </section>
  );
}

/** Falls back to the first county so the panel is never empty mid-load. */
function pickShown(
  counties: readonly CountyThreshold[],
  fips: string,
): CountyThreshold | null {
  return counties.find((c) => c.fips === fips) ?? counties[0] ?? null;
}

/**
 * One way in, sized to the panel. A reader who already has an account is sent
 * to their briefing instead of being asked to make a second one.
 *
 * The placeholder matters: `isAuthenticated` is false until the session
 * resolves, so rendering straight through would show a signed-in reader
 * "create an account" and then swap it out from under them.
 */
function HeroCta({
  signedIn,
  loading,
}: {
  signedIn: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation("landing");

  if (loading) {
    return (
      <div
        className="h-12 w-full animate-pulse rounded-lg bg-surface-sunk"
        aria-hidden="true"
      />
    );
  }

  if (signedIn) {
    return (
      <div>
        <Link
          href="/me/briefing"
          className={buttonVariants({ variant: "gold", size: "lg" })}
        >
          {t("counties.cta.briefing")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/register"
        className={`${buttonVariants({ variant: "gold", size: "lg" })} w-full`}
      >
        {t("counties.cta.start")}
      </Link>
      <p className="mt-3 text-sm text-content-dim">
        {t("counties.cta.haveAccount")}{" "}
        <Link href="/login">{t("counties.cta.signIn")}</Link>
      </p>
    </div>
  );
}

function Legend() {
  const { t } = useTranslation("landing");
  return (
    <p className="flex items-center gap-2.5 text-xs text-content-dim">
      <span>{t("counties.modes.rampLow")}</span>
      <span
        aria-hidden="true"
        className="h-2 w-[104px] rounded-[1px] bg-[linear-gradient(90deg,var(--map-ramp-low),var(--map-ramp-high))]"
      />
      <span>{t("counties.modes.rampHigh")}</span>
    </p>
  );
}

/**
 * Walk a shuffled route through the counties so a reader who does nothing
 * still sees the range.
 *
 * Shuffled rather than random: random repeats, and three tiny counties in a
 * row teaches nothing. Suspended while the pointer is over the map, because
 * nothing should move the figure out from under someone reading it, and
 * suspended for a hidden tab so a background page is not animating.
 *
 * The route is rotated to begin at `startFips`, the county already on screen,
 * so the first hop always lands somewhere new. Shuffling alone would sometimes
 * "advance" to the county the reader is already looking at, which reads as the
 * tour being broken.
 */
function useCountyTour({
  fipsList,
  startFips,
  enabled,
  paused,
  onAdvance,
}: {
  fipsList: readonly string[];
  startFips: string;
  enabled: boolean;
  paused: boolean;
  onAdvance: (fips: string) => void;
}) {
  // The interval reads these rather than closing over them, so hovering a
  // county does not tear down and restart the timer (which would silently
  // reset the 5s clock on every pointer move). Synced in an effect, not during
  // render: a timer is a macrotask, so it cannot fire before the effect runs.
  const pausedRef = useRef(paused);
  const advanceRef = useRef(onAdvance);
  useEffect(() => {
    pausedRef.current = paused;
    advanceRef.current = onAdvance;
  }, [paused, onAdvance]);

  // Keyed on the joined contents, not the array identity: `counties.map(...)`
  // builds a fresh array every render, and a shuffle keyed on that would
  // re-order the route on each one, restarting the tour forever.
  const key = fipsList.join(",");
  const route = useMemo(
    () => rotateTo(shuffle(key ? key.split(",") : []), startFips),
    [key, startFips],
  );

  useEffect(() => {
    if (!enabled || route.length === 0) return;

    let i = 0;
    const id = window.setInterval(() => {
      if (pausedRef.current || document.hidden) return;
      i = (i + 1) % route.length;
      advanceRef.current(route[i]);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [enabled, route]);
}

/** Rotates the route so it opens on `first`, leaving the cycle order intact. */
function rotateTo(route: string[], first: string): string[] {
  const at = route.indexOf(first);
  return at <= 0 ? route : [...route.slice(at), ...route.slice(0, at)];
}

function shuffle(items: string[]): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
