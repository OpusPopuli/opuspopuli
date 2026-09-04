"use client";

import { useMemo } from "react";
import { GeoJsonLayer } from "@deck.gl/layers";
import { useTranslation } from "react-i18next";
import { CivicMap } from "@/components/map/CivicMap";
import type { CountyThreshold } from "@/lib/graphql/counties";
import countyGeometry from "@/lib/data/ca-counties.geo.json";
import type { MapMode } from "./MapModeToggle";

/** California, framed so the whole state fits without panning. */
const CALIFORNIA_VIEW = { longitude: -119.4, latitude: 37.2, zoom: 4.6 };

type RGBA = [number, number, number, number];

const UNSHADED: RGBA = [30, 41, 59, 200]; // slate-800 — "no data", not "zero"
const RAMP_LOW: RGBA = [8, 47, 73, 235]; // sky-950
const RAMP_HIGH: RGBA = [56, 189, 248, 235]; // sky-400
const SELECTED_LINE: RGBA = [248, 250, 252, 255];
const LINE: RGBA = [15, 23, 42, 255];

interface CountyFeatureProps {
  fips: string;
  name: string;
}

export interface CountyMapProps {
  counties: CountyThreshold[];
  mode: MapMode;
  selectedFips: string | null;
  onSelect: (fips: string) => void;
  /** Skip the fill transition. Threaded in so the caller owns the media query. */
  reducedMotion?: boolean;
  className?: string;
}

function lerp(a: RGBA, b: RGBA, t: number): RGBA {
  const c = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * c),
    Math.round(a[1] + (b[1] - a[1]) * c),
    Math.round(a[2] + (b[2] - a[2]) * c),
    Math.round(a[3] + (b[3] - a[3]) * c),
  ];
}

/**
 * Position a county on its ramp, 0..1.
 *
 * `share` is linear: the values sit in a narrow band (3.28%-6.98% across all
 * 58), so a linear ramp uses the full colour range on the differences that
 * exist.
 *
 * `people` is logarithmic because raw counts span four orders of magnitude —
 * 62 signatures in Alpine against 238,923 in Los Angeles. Linear there renders
 * 55 of 58 counties as the same dark blue and says nothing.
 */
export function rampPosition(
  county: CountyThreshold,
  mode: MapMode,
  bounds: { min: number; max: number },
): number | null {
  const value =
    mode === "share" ? county.shareOfRegistered : county.signaturesRequired;
  if (value === null || value === undefined) return null;
  if (bounds.max === bounds.min) return 0.5;

  if (mode === "people") {
    const lo = Math.log10(Math.max(1, bounds.min));
    const hi = Math.log10(Math.max(1, bounds.max));
    return hi === lo ? 0.5 : (Math.log10(Math.max(1, value)) - lo) / (hi - lo);
  }
  return (value - bounds.min) / (bounds.max - bounds.min);
}

export function CountyMap({
  counties,
  mode,
  selectedFips,
  onSelect,
  reducedMotion = false,
  className,
}: CountyMapProps) {
  const { t, i18n } = useTranslation("landing");

  const byFips = useMemo(
    () => new Map(counties.map((c) => [c.fips, c])),
    [counties],
  );

  const bounds = useMemo(() => {
    const values = counties
      .map((c) =>
        mode === "share" ? c.shareOfRegistered : c.signaturesRequired,
      )
      .filter((v): v is number => v !== null && v !== undefined);
    return values.length
      ? { min: Math.min(...values), max: Math.max(...values) }
      : { min: 0, max: 1 };
  }, [counties, mode]);

  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );

  const layers = useMemo(
    () => [
      new GeoJsonLayer<CountyFeatureProps>({
        id: `counties-${mode}`,
        data: countyGeometry as never,
        filled: true,
        stroked: true,
        pickable: true,
        getFillColor: (f) => {
          const county = byFips.get(f.properties.fips);
          if (!county) return UNSHADED;
          const position = rampPosition(county, mode, bounds);
          // A county with no figure stays unshaded rather than landing at the
          // bottom of the ramp, which would read as "lowest" instead of
          // "unknown".
          return position === null
            ? UNSHADED
            : lerp(RAMP_LOW, RAMP_HIGH, position);
        },
        getLineColor: (f) =>
          f.properties.fips === selectedFips ? SELECTED_LINE : LINE,
        getLineWidth: (f) => (f.properties.fips === selectedFips ? 2200 : 700),
        lineWidthUnits: "meters",
        onClick: (info) => {
          const props = info.object?.properties as
            | CountyFeatureProps
            | undefined;
          if (props) onSelect(props.fips);
        },
        updateTriggers: {
          getFillColor: [mode, bounds.min, bounds.max, counties],
          getLineColor: [selectedFips],
          getLineWidth: [selectedFips],
        },
        // Honour prefers-reduced-motion: the colour cross-fade is decorative,
        // and an animated recolour of 58 shapes is exactly what that setting
        // exists to suppress.
        transitions: reducedMotion ? {} : { getFillColor: 300 },
      }),
    ],
    [byFips, bounds, mode, selectedFips, onSelect, counties, reducedMotion],
  );

  return (
    <div className={className}>
      <CivicMap
        layers={layers}
        initialViewState={CALIFORNIA_VIEW}
        ariaLabel={t("counties.heading")}
        className="h-full w-full"
      />

      {/*
        The map draws to a canvas, so its shapes are not reachable by keyboard
        and do not exist to assistive technology. This list is the same
        information as real controls: one focusable button per county, each
        labelled with its name and requirement.

        It is visually hidden rather than absent — hiding it with `display:none`
        or `aria-hidden` would take it out of the accessibility tree too, which
        is the failure this exists to prevent (WCAG 2.1.1).
      */}
      <ul className="sr-only">
        {counties.map((county) => (
          <li key={county.fips}>
            <button
              type="button"
              onClick={() => onSelect(county.fips)}
              aria-pressed={county.fips === selectedFips}
            >
              {t("counties.rail.cheapestNeighborValue", {
                name: county.name,
                count: nf.format(county.signaturesRequired),
              })}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
