"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import Supercluster from "supercluster";
import type { PetitionMapMarker } from "../../lib/graphql/documents";

export interface ClusterFeature {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  isCluster: boolean;
  markers: PetitionMapMarker[];
}

interface PetitionLayerProps {
  markers: PetitionMapMarker[];
  zoom: number;
  bounds?: { swLat: number; swLng: number; neLat: number; neLng: number };
  selectedId: string | null;
  onSelect: (marker: PetitionMapMarker | null) => void;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function markerSize(count: number): number {
  return Math.max(14, Math.min(48, 14 + (count / 100) * 34));
}

export function PetitionLayer({
  markers,
  zoom,
  bounds,
  selectedId,
  onSelect,
}: PetitionLayerProps) {
  const [pulse, setPulse] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame++;
      setPulse(Math.sin(frame * 0.04) * 0.5 + 0.5);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const index = useMemo(() => {
    const sc = new Supercluster<{ marker: PetitionMapMarker }>({
      radius: 60,
      maxZoom: 16,
    });
    const points = markers.map((m) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [m.longitude, m.latitude] as [number, number],
      },
      properties: { marker: m },
    }));
    sc.load(points);
    return sc;
  }, [markers]);

  const clusters = useMemo((): ClusterFeature[] => {
    if (!bounds) return [];
    const bbox: [number, number, number, number] = [
      bounds.swLng,
      bounds.swLat,
      bounds.neLng,
      bounds.neLat,
    ];
    const raw = index.getClusters(bbox, Math.floor(zoom));
    return raw.map((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties as Record<string, unknown>;
      if (props.cluster) {
        const clusterId = props.cluster_id as number;
        const leaves = index.getLeaves(clusterId, Infinity);
        return {
          id: `cluster-${clusterId}`,
          latitude: lat,
          longitude: lng,
          count: props.point_count as number,
          isCluster: true,
          markers: leaves.map(
            (l) => (l.properties as { marker: PetitionMapMarker }).marker,
          ),
        };
      }
      const marker = (props as { marker: PetitionMapMarker }).marker;
      return {
        id: marker.id,
        latitude: lat,
        longitude: lng,
        count: 1,
        isCluster: false,
        markers: [marker],
      };
    });
  }, [index, bounds, zoom]);

  const handleClick = useCallback(
    (cluster: ClusterFeature) => {
      if (cluster.isCluster) {
        // For clusters, select the first marker (or could zoom in)
        onSelect(cluster.markers[0]);
      } else {
        const marker = cluster.markers[0];
        onSelect(selectedId === marker.id ? null : marker);
      }
    },
    [onSelect, selectedId],
  );

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {clusters.map((cluster) => {
        const isSelected =
          !cluster.isCluster && cluster.markers[0].id === selectedId;
        const size = markerSize(cluster.count);
        const r = size / 2;
        const glowR = r * (1 + pulse * 0.25);

        // We use CSS transform for positioning via the parent MapView
        // For the SVG overlay approach, coordinates are managed by the map
        return (
          <g
            key={cluster.id}
            data-marker-id={cluster.id}
            data-lat={cluster.latitude}
            data-lng={cluster.longitude}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
            onClick={() => handleClick(cluster)}
          >
            {/* Glow ring */}
            <circle
              r={glowR * 2.2}
              fill="none"
              stroke={isSelected ? "#c8a84b" : "#4a8fa8"}
              strokeWidth="1"
              opacity={0.3 + pulse * 0.3}
            />
            {/* Outer ring */}
            <circle
              r={r * 1.6}
              fill="none"
              stroke={isSelected ? "#c8a84b" : "#4a8fa8"}
              strokeWidth="1.5"
              opacity={0.5}
            />
            {/* Main circle */}
            <circle
              r={r}
              fill={
                isSelected ? "rgba(200,168,75,0.9)" : "rgba(74,143,168,0.85)"
              }
              stroke={isSelected ? "#f0d070" : "#8fcfe8"}
              strokeWidth="1.5"
            />
            {/* Count text */}
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={r * 0.7}
              fill="white"
              fontWeight="bold"
              style={{ fontFamily: "sans-serif" }}
            >
              {formatCount(cluster.count)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export { type PetitionMapMarker };
