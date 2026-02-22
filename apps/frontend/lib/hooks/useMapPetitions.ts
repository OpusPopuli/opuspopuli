"use client";

import { useQuery } from "@apollo/client/react";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  GET_PETITION_MAP_LOCATIONS,
  GET_PETITION_MAP_STATS,
  PetitionMapLocationsData,
  PetitionMapStatsData,
  MapFiltersInput,
  MapBoundsInput,
  PetitionMapMarker,
  PetitionMapStats,
} from "../graphql/documents";

export interface UseMapPetitionsReturn {
  markers: PetitionMapMarker[];
  stats: PetitionMapStats | null;
  loading: boolean;
  error: Error | null;
  updateBounds: (bounds: MapBoundsInput) => void;
  updateFilters: (filters: Partial<MapFiltersInput>) => void;
  filters: MapFiltersInput;
}

const DEBOUNCE_MS = 300;

export function useMapPetitions(
  initialFilters?: Partial<MapFiltersInput>,
): UseMapPetitionsReturn {
  const [filters, setFilters] = useState<MapFiltersInput>({
    ...initialFilters,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    data: locationsData,
    loading: locationsLoading,
    error: locationsError,
  } = useQuery<PetitionMapLocationsData>(GET_PETITION_MAP_LOCATIONS, {
    variables: {
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
    fetchPolicy: "cache-and-network",
  });

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
  } = useQuery<PetitionMapStatsData>(GET_PETITION_MAP_STATS, {
    fetchPolicy: "cache-and-network",
  });

  const updateBounds = useCallback((bounds: MapBoundsInput) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, bounds }));
    }, DEBOUNCE_MS);
  }, []);

  const updateFilters = useCallback((newFilters: Partial<MapFiltersInput>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return {
    markers: locationsData?.petitionMapLocations ?? [],
    stats: statsData?.petitionMapStats ?? null,
    loading: locationsLoading || statsLoading,
    error: locationsError ?? statsError ?? null,
    updateBounds,
    updateFilters,
    filters,
  };
}
