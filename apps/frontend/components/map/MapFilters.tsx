"use client";

import { useCallback } from "react";
import type { MapFiltersInput } from "../../lib/graphql/documents";

interface MapFiltersProps {
  filters: MapFiltersInput;
  onUpdateFilters: (filters: Partial<MapFiltersInput>) => void;
  onNearMe: () => void;
  locationLoading: boolean;
}

export function MapFilters({
  filters,
  onUpdateFilters,
  onNearMe,
  locationLoading,
}: MapFiltersProps) {
  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onUpdateFilters({ documentType: value || undefined });
    },
    [onUpdateFilters],
  );

  const handleStartDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      onUpdateFilters({ startDate: value || undefined });
    },
    [onUpdateFilters],
  );

  const handleEndDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      onUpdateFilters({ endDate: value || undefined });
    },
    [onUpdateFilters],
  );

  const inputStyle: React.CSSProperties = {
    background: "rgba(10,15,26,0.8)",
    border: "1px solid #1e2d45",
    borderRadius: 4,
    color: "#e8dcc8",
    padding: "4px 8px",
    fontSize: 11,
    fontFamily: "'Georgia', serif",
    outline: "none",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "5px 14px",
    borderRadius: 4,
    border: "1px solid #1e2d45",
    background: "transparent",
    color: "#4a8fa8",
    fontSize: 11,
    letterSpacing: "1px",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "'Georgia', serif",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        display: "flex",
        gap: 8,
        zIndex: 20,
        flexWrap: "wrap",
      }}
    >
      <select
        value={filters.documentType ?? ""}
        onChange={handleTypeChange}
        style={inputStyle}
        aria-label="Filter by document type"
      >
        <option value="">All types</option>
        <option value="petition">Petition</option>
        <option value="proposition">Proposition</option>
        <option value="contract">Contract</option>
        <option value="report">Report</option>
      </select>

      <input
        type="date"
        value={filters.startDate ?? ""}
        onChange={handleStartDateChange}
        style={inputStyle}
        aria-label="Start date"
        placeholder="From"
      />

      <input
        type="date"
        value={filters.endDate ?? ""}
        onChange={handleEndDateChange}
        style={inputStyle}
        aria-label="End date"
        placeholder="To"
      />

      <button
        onClick={onNearMe}
        disabled={locationLoading}
        style={{
          ...buttonStyle,
          opacity: locationLoading ? 0.5 : 1,
        }}
        aria-label="Center map on my location"
      >
        {locationLoading ? "Locating..." : "Near me"}
      </button>
    </div>
  );
}
