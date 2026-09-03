"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * A map surface that renders deck.gl layers and knows nothing else.
 *
 * Deliberately generic (#1105 criterion 10): the California landing page is
 * the first consumer, the petition map is the second. If this component ever
 * mentions a county, a threshold or §9118, it has stopped being the shared
 * abstraction it exists to be — there is a test that greps for exactly that.
 *
 * ── No tile source, on purpose ──────────────────────────────────────────
 *
 * The style has a background layer and nothing else, which is a valid
 * MapLibre style. Polygons render on the brand ground.
 *
 * That is a **privacy property** before it is a performance one: the landing
 * page is the highest-traffic surface in the product, and a basemap would
 * mean every visitor's viewport — which is to say, roughly where they are and
 * what they are looking at — reaching a third-party tile vendor before they
 * have agreed to anything. There is no vendor to send it to here. The
 * accompanying test asserts the style carries no sources, no glyphs and no
 * sprite, so this cannot be undone by adding "just a basemap" later without
 * the test failing.
 *
 * ── Bundle cost ─────────────────────────────────────────────────────────
 *
 * MapLibre plus deck.gl is ~400-450KB gzipped. This module therefore has no
 * top-level side effects and is safe to `next/dynamic({ ssr: false })`; the
 * static-snapshot swap that keeps it off the critical path belongs to #1110.
 */

export interface CivicMapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface CivicMapProps {
  /** deck.gl layers. The only thing that drives what is drawn. */
  layers: Layer[];
  /** Where the camera starts. Not controlled — see `interactive`. */
  initialViewState: CivicMapViewState;
  /** Ground colour behind the layers. */
  backgroundColor?: string;
  /**
   * Whether the user can pan and zoom.
   *
   * Off by default: a decorative map that steals scroll on a landing page is
   * a usability failure, and a fixed frame is also what makes the static
   * snapshot in #1110 interchangeable with the live map.
   */
  interactive?: boolean;
  /** Fires after the user moves the camera. Only meaningful when interactive. */
  onViewStateChange?: (viewState: CivicMapViewState) => void;
  className?: string;
  /**
   * Accessible name for the map region.
   *
   * Required, not optional. A canvas is opaque to assistive technology, so
   * without this the map is an unlabelled interactive region — a WCAG 2.2 AA
   * failure (1.1.1, 4.1.2). Callers must also render the same information in
   * text elsewhere; the map is never the only route to it.
   */
  ariaLabel: string;
}

/**
 * A style with no sources, no glyphs and no sprite issues zero network
 * requests. Built per call so a caller's background colour cannot mutate a
 * shared object.
 */
export function backgroundOnlyStyle(
  backgroundColor: string,
): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": backgroundColor },
      },
    ],
  };
}

const DEFAULT_BACKGROUND = "#0a0f1a";

export function CivicMap({
  layers,
  initialViewState,
  backgroundColor = DEFAULT_BACKGROUND,
  interactive = false,
  onViewStateChange,
  className,
  ariaLabel,
}: CivicMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  // Read inside the move handler so a changing callback does not tear down
  // and rebuild the map, which would reset the camera under the user.
  const onViewStateChangeRef = useRef(onViewStateChange);
  onViewStateChangeRef.current = onViewStateChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: backgroundOnlyStyle(backgroundColor),
      center: [initialViewState.longitude, initialViewState.latitude],
      zoom: initialViewState.zoom,
      interactive,
      // No vendor to attribute — the control would render an empty box.
      attributionControl: false,
    });
    mapRef.current = map;

    // Interleaved so deck.gl layers share MapLibre's depth buffer rather than
    // being painted over it, which is what lets polygons sit correctly against
    // anything MapLibre draws later.
    const overlay = new MapboxOverlay({ interleaved: true, layers });
    overlayRef.current = overlay;
    map.addControl(overlay);

    const handleMoveEnd = () => {
      const center = map.getCenter();
      onViewStateChangeRef.current?.({
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
      });
    };
    map.on("moveend", handleMoveEnd);

    return () => {
      map.off("moveend", handleMoveEnd);
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // Rebuilding on every prop change would restart the map; layer updates go
    // through the overlay below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layers flow to the existing overlay rather than remounting the map.
  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  useEffect(() => {
    mapRef.current?.setStyle(backgroundOnlyStyle(backgroundColor));
  }, [backgroundColor]);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
      data-testid="civic-map"
    />
  );
}
