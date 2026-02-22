"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { Marker } from "react-map-gl/maplibre";
import Supercluster from "supercluster";
import type { PetitionMapMarker } from "../../lib/graphql/documents";

export interface ClusterFeature {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  isCluster: boolean;
  clusterId?: number;
  markers: PetitionMapMarker[];
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function markerSize(count: number): number {
  return Math.max(24, Math.min(56, 24 + (count / 50) * 32));
}

interface PetitionMarkersProps {
  markers: PetitionMapMarker[];
  zoom: number;
  bounds?: { swLat: number; swLng: number; neLat: number; neLng: number };
  selectedId: string | null;
  onSelect: (marker: PetitionMapMarker | null) => void;
}

export function PetitionMarkers({
  markers,
  zoom,
  bounds,
  selectedId,
  onSelect,
}: PetitionMarkersProps) {
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
          clusterId,
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
        onSelect(cluster.markers[0]);
      } else {
        const marker = cluster.markers[0];
        onSelect(selectedId === marker.id ? null : marker);
      }
    },
    [onSelect, selectedId],
  );

  return (
    <>
      {clusters.map((cluster) => {
        const isSelected =
          !cluster.isCluster && cluster.markers[0].id === selectedId;
        const size = markerSize(cluster.count);
        const r = size / 2;
        const glowR = r * (1 + pulse * 0.25);

        return (
          <Marker
            key={cluster.id}
            latitude={cluster.latitude}
            longitude={cluster.longitude}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              handleClick(cluster);
            }}
          >
            <svg
              width={glowR * 4.4 + 4}
              height={glowR * 4.4 + 4}
              viewBox={`${-(glowR * 2.2 + 2)} ${-(glowR * 2.2 + 2)} ${glowR * 4.4 + 4} ${glowR * 4.4 + 4}`}
              style={{ cursor: "pointer", overflow: "visible" }}
            >
              {/* Glow ring */}
              <circle
                cx={0}
                cy={0}
                r={glowR * 2.2}
                fill="none"
                stroke={isSelected ? "#c8a84b" : "#4a8fa8"}
                strokeWidth="1"
                opacity={0.3 + pulse * 0.3}
              />
              {/* Outer ring */}
              <circle
                cx={0}
                cy={0}
                r={r * 1.6}
                fill="none"
                stroke={isSelected ? "#c8a84b" : "#4a8fa8"}
                strokeWidth="1.5"
                opacity={0.5}
              />
              {/* Main circle */}
              <circle
                cx={0}
                cy={0}
                r={r}
                fill={
                  isSelected ? "rgba(200,168,75,0.9)" : "rgba(74,143,168,0.85)"
                }
                stroke={isSelected ? "#f0d070" : "#8fcfe8"}
                strokeWidth="1.5"
              />
              {/* Count text */}
              <text
                x={0}
                y={0}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(10, r * 0.65)}
                fill="white"
                fontWeight="bold"
                style={{ fontFamily: "sans-serif", pointerEvents: "none" }}
              >
                {formatCount(cluster.count)}
              </text>
            </svg>
          </Marker>
        );
      })}
    </>
  );
}
