"use client";

import { useState, useCallback, useRef } from "react";
import { MapView } from "@/components/map/MapView";
import { PetitionMarkers } from "@/components/map/PetitionMarkers";
import { PetitionSidebar } from "@/components/map/PetitionSidebar";
import { MapLegend } from "@/components/map/MapLegend";
import { MapFilters } from "@/components/map/MapFilters";
import { useMapPetitions } from "@/lib/hooks/useMapPetitions";
import { useGeolocation } from "@/lib/hooks/useGeolocation";
import type {
  PetitionMapMarker,
  MapBoundsInput,
} from "@/lib/graphql/documents";

type ActiveLayer = "clusters" | "both";

export function MapPageClient() {
  const [selectedMarker, setSelectedMarker] =
    useState<PetitionMapMarker | null>(null);
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>("clusters");
  const [zoom, setZoom] = useState(4);
  const [currentBounds, setCurrentBounds] = useState<
    MapBoundsInput | undefined
  >();

  const {
    markers,
    stats,
    loading,
    error,
    updateBounds,
    updateFilters,
    filters,
  } = useMapPetitions();
  const { requestLocation, isLoading: locationLoading } = useGeolocation();

  const mapCenterRef = useRef<{ latitude: number; longitude: number } | null>(
    null,
  );

  const handleMoveEnd = useCallback(
    (bounds: MapBoundsInput) => {
      setCurrentBounds(bounds);
      updateBounds(bounds);
      // Estimate zoom from bounds span
      const latSpan = bounds.neLat - bounds.swLat;
      if (latSpan > 0) {
        const estimatedZoom = Math.max(
          1,
          Math.min(18, Math.log2(180 / latSpan)),
        );
        setZoom(estimatedZoom);
      }
    },
    [updateBounds],
  );

  const handleSelect = useCallback((marker: PetitionMapMarker | null) => {
    setSelectedMarker(marker);
  }, []);

  const handleNearMe = useCallback(async () => {
    const coords = await requestLocation();
    if (coords) {
      mapCenterRef.current = {
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
      // Force re-render with new center by using window location
      // For now, we reload the map component with new initial center
      globalThis.location.hash = `#${coords.latitude},${coords.longitude},12`;
      globalThis.location.reload();
    }
  }, [requestLocation]);

  // Parse hash for initial center
  let initialCenter: { latitude: number; longitude: number } | undefined;
  let initialZoom: number | undefined;
  if (typeof globalThis !== "undefined" && globalThis.location?.hash) {
    const parts = globalThis.location.hash.substring(1).split(",");
    if (parts.length >= 2) {
      initialCenter = {
        latitude: Number.parseFloat(parts[0]),
        longitude: Number.parseFloat(parts[1]),
      };
      if (parts.length >= 3) {
        initialZoom = Number.parseFloat(parts[2]);
      }
    }
  }

  return (
    <div
      style={{
        fontFamily: "'Georgia', serif",
        background: "#0a0f1a",
        height: "100vh",
        color: "#e8dcc8",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid #1e2d45",
          padding: "16px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(10,15,26,0.95)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.5px",
              color: "#e8dcc8",
            }}
          >
            Opus Populi
          </span>
          <span
            style={{
              fontSize: 12,
              color: "#4a6080",
              letterSpacing: "2px",
              textTransform: "uppercase",
            }}
          >
            Civic Petition Map
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["clusters", "both"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setActiveLayer(l)}
              aria-label={`Show ${l} layer`}
              aria-pressed={activeLayer === l}
              style={{
                padding: "5px 14px",
                borderRadius: 4,
                border:
                  activeLayer === l ? "1px solid #c8a84b" : "1px solid #1e2d45",
                background:
                  activeLayer === l ? "rgba(200,168,75,0.15)" : "transparent",
                color: activeLayer === l ? "#c8a84b" : "#4a6080",
                fontSize: 11,
                letterSpacing: "1px",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "8px 28px",
            background: "rgba(200,50,50,0.15)",
            color: "#ff8888",
            fontSize: 12,
            borderBottom: "1px solid #3a1515",
          }}
        >
          Failed to load petition data: {error.message}
        </div>
      )}

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Map Area */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <MapView
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            onMoveEnd={handleMoveEnd}
          >
            {(activeLayer === "clusters" || activeLayer === "both") && (
              <PetitionMarkers
                markers={markers}
                zoom={zoom}
                bounds={currentBounds}
                selectedId={selectedMarker?.id ?? null}
                onSelect={handleSelect}
              />
            )}
          </MapView>

          {/* Overlays */}
          <MapFilters
            filters={filters}
            onUpdateFilters={updateFilters}
            onNearMe={handleNearMe}
            locationLoading={locationLoading}
          />
          <MapLegend />
        </div>

        {/* Sidebar */}
        <PetitionSidebar
          markers={markers}
          stats={stats}
          selectedMarker={selectedMarker}
          onSelect={handleSelect}
          loading={loading}
        />
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: none; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #080d16; }
        ::-webkit-scrollbar-thumb { background: #1e2d45; border-radius: 2px; }
      `}</style>
    </div>
  );
}
