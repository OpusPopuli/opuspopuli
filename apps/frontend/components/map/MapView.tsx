"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import Map, { MapRef, ViewStateChangeEvent } from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import type { MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";

// Dark basemap style matching the midnight navy aesthetic
const DARK_STYLE: StyleSpecification = {
  version: 8,
  name: "Opus Dark",
  sources: {
    protomaps: {
      type: "vector",
      url: "pmtiles://https://build.protomaps.com/20240701.pmtiles",
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0a0f1a" },
    },
    {
      id: "water",
      type: "fill",
      source: "protomaps",
      "source-layer": "water",
      paint: { "fill-color": "#0d1825" },
    },
    {
      id: "landuse-park",
      type: "fill",
      source: "protomaps",
      "source-layer": "landuse",
      filter: ["==", "pmap:kind", "park"],
      paint: { "fill-color": "#0e1a24", "fill-opacity": 0.5 },
    },
    {
      id: "roads-highway",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      filter: ["==", "pmap:kind", "highway"],
      paint: {
        "line-color": "#1a2d42",
        "line-width": 1.5,
        "line-opacity": 0.6,
      },
    },
    {
      id: "roads-major",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      filter: ["==", "pmap:kind", "major_road"],
      paint: {
        "line-color": "#152235",
        "line-width": 0.8,
        "line-opacity": 0.4,
      },
    },
    {
      id: "roads-minor",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      filter: ["==", "pmap:kind", "minor_road"],
      paint: {
        "line-color": "#121d2d",
        "line-width": 0.5,
        "line-opacity": 0.3,
      },
    },
    {
      id: "boundaries",
      type: "line",
      source: "protomaps",
      "source-layer": "boundaries",
      paint: {
        "line-color": "#1e3a5a",
        "line-width": 1,
        "line-opacity": 0.5,
      },
    },
    {
      id: "place-labels",
      type: "symbol",
      source: "protomaps",
      "source-layer": "places",
      filter: ["<=", "pmap:min_zoom", 8],
      layout: {
        "text-field": "{name}",
        "text-size": 12,
        "text-font": ["Noto Sans Regular"],
      },
      paint: {
        "text-color": "#2a4060",
        "text-halo-color": "#0a0f1a",
        "text-halo-width": 1,
      },
    },
  ],
  glyphs: "https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf",
};

// Default to center of continental US
const DEFAULT_VIEW = {
  longitude: -98.5,
  latitude: 39.8,
  zoom: 4,
};

export interface MapViewProps {
  initialCenter?: { latitude: number; longitude: number };
  initialZoom?: number;
  onMoveEnd?: (bounds: {
    swLat: number;
    swLng: number;
    neLat: number;
    neLng: number;
  }) => void;
  onClick?: (event: { latitude: number; longitude: number }) => void;
  children?: React.ReactNode;
}

export function MapView({
  initialCenter,
  initialZoom,
  onMoveEnd,
  onClick,
  children,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const [protocolAdded, setProtocolAdded] = useState(false);

  useEffect(() => {
    const protocol = new Protocol();
    // maplibregl addProtocol is imported via react-map-gl/maplibre
    // The Protocol registers itself globally
    import("maplibre-gl").then((maplibregl) => {
      maplibregl.addProtocol("pmtiles", protocol.tile);
      setProtocolAdded(true);
    });
    return () => {
      import("maplibre-gl").then((maplibregl) => {
        maplibregl.removeProtocol("pmtiles");
      });
    };
  }, []);

  const handleMoveEnd = useCallback(
    (evt: ViewStateChangeEvent) => {
      if (!onMoveEnd || !mapRef.current) return;
      const map = mapRef.current.getMap();
      const bounds = map.getBounds();
      onMoveEnd({
        swLat: bounds.getSouth(),
        swLng: bounds.getWest(),
        neLat: bounds.getNorth(),
        neLng: bounds.getEast(),
      });
    },
    [onMoveEnd],
  );

  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (!onClick) return;
      onClick({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    },
    [onClick],
  );

  if (!protocolAdded) {
    return (
      <div
        style={{
          flex: 1,
          background: "#0a0f1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#4a6080",
          fontFamily: "Georgia, serif",
        }}
      >
        Loading map...
      </div>
    );
  }

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: initialCenter?.longitude ?? DEFAULT_VIEW.longitude,
        latitude: initialCenter?.latitude ?? DEFAULT_VIEW.latitude,
        zoom: initialZoom ?? DEFAULT_VIEW.zoom,
      }}
      style={{ flex: 1 }}
      mapStyle={DARK_STYLE}
      onMoveEnd={handleMoveEnd}
      onClick={handleClick}
      attributionControl={false}
    >
      {children}
    </Map>
  );
}
