"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GeoJsonLayer } from "@deck.gl/layers";
import { useTranslation } from "react-i18next";
import { CivicMap } from "@/components/map/CivicMap";
import type { CountyThreshold } from "@/lib/graphql/counties";
import countyGeometry from "@/lib/data/ca-counties.geo.json";
import type { MapMode } from "./MapModeToggle";

/** California, framed so the whole state fits without panning. */
const CALIFORNIA_VIEW = { longitude: -119.4, latitude: 37.2, zoom: 4.6 };

type RGBA = [number, number, number, number];

interface RampPalette {
  low: string;
  high: string;
  unshaded: string;
  line: string;
}

/** Fallbacks for SSR and for tests, where no stylesheet is applied. */
const FALLBACK: RampPalette = {
  low: "#f2e7b0",
  high: "#c9a300",
  unshaded: "#e4e0d6",
  line: "#fafaf8",
};

interface CountyFeatureProps {
  fips: string;
  name: string;
}

interface HoverState {
  county: CountyThreshold;
  x: number;
  y: number;
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

/** `#rgb` / `#rrggbb` → deck.gl's RGBA tuple. */
export function hexToRgba(hex: string, alpha = 255): RGBA {
  const clean = hex.trim().replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const n = Number.parseInt(full, 16);
  return Number.isFinite(n) && full.length === 6
    ? [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
    : [0, 0, 0, alpha];
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
 * 55 of 58 counties as the same shade and says nothing.
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

/**
 * Read the ramp from the stylesheet so the map follows the theme.
 *
 * Hardcoding the colours here would leave the map on its light-theme palette
 * when the rest of the page goes dark — the shading is design-system material,
 * not map material.
 */
function useRampPalette() {
  const [palette, setPalette] = useState<RampPalette>(FALLBACK);

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const value = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;
      setPalette({
        low: value("--map-ramp-low", FALLBACK.low),
        high: value("--map-ramp-high", FALLBACK.high),
        unshaded: value("--map-ramp-unshaded", FALLBACK.unshaded),
        line: value("--color-surface", FALLBACK.line),
      });
    };
    read();

    // The theme is a class on <html>, so re-read when it changes.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return palette;
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
  const palette = useRampPalette();
  const [hover, setHover] = useState<HoverState | null>(null);

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
  const pf = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: "percent",
        maximumFractionDigits: 2,
      }),
    [i18n.language],
  );

  const handleHover = useCallback(
    (info: {
      object?: { properties?: CountyFeatureProps };
      x: number;
      y: number;
    }) => {
      const fips = info.object?.properties?.fips;
      const county = fips ? byFips.get(fips) : undefined;
      setHover(county ? { county, x: info.x, y: info.y } : null);
    },
    [byFips],
  );

  const layers = useMemo(() => {
    const low = hexToRgba(palette.low);
    const high = hexToRgba(palette.high);
    const unshaded = hexToRgba(palette.unshaded);
    const line = hexToRgba(palette.line);
    const ink = hexToRgba("#1a1714");

    return [
      new GeoJsonLayer<CountyFeatureProps>({
        id: `counties-${mode}`,
        data: countyGeometry as never,
        filled: true,
        stroked: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: hexToRgba(palette.high, 235),
        getFillColor: (f) => {
          const county = byFips.get(f.properties.fips);
          if (!county) return unshaded;
          const position = rampPosition(county, mode, bounds);
          // A county with no figure stays unshaded rather than landing at the
          // bottom of the ramp, where it would read as "lowest" instead of
          // "unknown".
          return position === null ? unshaded : lerp(low, high, position);
        },
        // Hairlines in the page colour, so counties separate without a border
        // being drawn around the state.
        getLineColor: (f) => (f.properties.fips === selectedFips ? ink : line),
        getLineWidth: (f) => (f.properties.fips === selectedFips ? 2200 : 600),
        lineWidthUnits: "meters",
        onClick: (info) => {
          const props = info.object?.properties as
            | CountyFeatureProps
            | undefined;
          if (props) onSelect(props.fips);
        },
        onHover: handleHover,
        updateTriggers: {
          getFillColor: [mode, bounds.min, bounds.max, counties, palette],
          getLineColor: [selectedFips, palette],
          getLineWidth: [selectedFips],
        },
        // Honour prefers-reduced-motion: the colour cross-fade is decorative,
        // and an animated recolour of 58 shapes is what that setting exists to
        // suppress.
        transitions: reducedMotion ? {} : { getFillColor: 300 },
      }),
    ];
  }, [
    byFips,
    bounds,
    mode,
    selectedFips,
    onSelect,
    counties,
    reducedMotion,
    palette,
    handleHover,
  ]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <CivicMap
        layers={layers}
        initialViewState={CALIFORNIA_VIEW}
        ariaLabel={t("counties.heading")}
        className="h-full w-full"
      />

      {hover && (
        // Pointer-events off so the tooltip cannot sit between the cursor and
        // the county it describes, which would flicker it in and out.
        <div
          role="presentation"
          className="pointer-events-none absolute z-10 rounded border border-[var(--color-line)] bg-surface px-3 py-2 text-sm shadow-lg"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="font-semibold text-content">{hover.county.name}</div>
          <div className="tabular-nums text-content">
            {nf.format(hover.county.signaturesRequired)}{" "}
            <span className="text-content-dim">
              {t("counties.rail.signaturesRequired").toLowerCase()}
            </span>
          </div>
          {hover.county.shareOfRegistered !== null && (
            <div className="text-xs text-content-dim">
              {pf.format(hover.county.shareOfRegistered)}{" "}
              {t("counties.rail.shareOfRegistered").toLowerCase()}
            </div>
          )}
        </div>
      )}

      {/*
        The map draws to a canvas, so its shapes are not reachable by keyboard
        and do not exist to assistive technology. This list is the same
        information as real controls: one focusable button per county, each
        labelled with its name and requirement.

        Visually hidden rather than absent — `display:none` or `aria-hidden`
        would take it out of the accessibility tree too, which is the failure
        this exists to prevent (WCAG 2.1.1).
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
