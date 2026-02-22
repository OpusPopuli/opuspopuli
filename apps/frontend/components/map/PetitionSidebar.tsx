"use client";

import type {
  PetitionMapMarker,
  PetitionMapStats,
} from "../../lib/graphql/documents";

interface PetitionSidebarProps {
  markers: PetitionMapMarker[];
  stats: PetitionMapStats | null;
  selectedMarker: PetitionMapMarker | null;
  onSelect: (marker: PetitionMapMarker | null) => void;
  loading: boolean;
}

export function PetitionSidebar({
  markers,
  stats,
  selectedMarker,
  onSelect,
  loading,
}: PetitionSidebarProps) {
  const sorted = [...markers].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div
      style={{
        width: 320,
        background: "rgba(8,13,22,0.95)",
        borderLeft: "1px solid #1e2d45",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'Georgia', serif",
      }}
    >
      {/* Selected Petition Detail */}
      {selectedMarker && (
        <div
          style={{
            padding: 20,
            borderBottom: "1px solid #1e2d45",
            background: "rgba(200,168,75,0.05)",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#c8a84b",
              letterSpacing: "2px",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Selected Petition
          </div>
          <div
            style={{
              fontSize: 15,
              color: "#e8dcc8",
              lineHeight: 1.4,
              marginBottom: 12,
            }}
          >
            {selectedMarker.documentType ?? "Petition"}
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: "#c8a84b",
                  fontFamily: "monospace",
                }}
              >
                {selectedMarker.id.substring(0, 8)}...
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#4a6080",
                  letterSpacing: "1px",
                }}
              >
                DOCUMENT ID
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "#4a8fa8" }}>
                {new Date(selectedMarker.createdAt).toLocaleDateString()}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#4a6080",
                  letterSpacing: "1px",
                }}
              >
                SCANNED
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "#4a6080" }}>
            {selectedMarker.latitude.toFixed(4)},{" "}
            {selectedMarker.longitude.toFixed(4)}
          </div>
        </div>
      )}

      {/* Petition List */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        <div
          style={{
            padding: "16px 20px 8px",
            fontSize: 10,
            color: "#4a6080",
            letterSpacing: "2px",
            textTransform: "uppercase",
          }}
        >
          All Petitions ({markers.length})
        </div>

        {loading && markers.length === 0 && (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "#4a6080",
              fontSize: 13,
            }}
          >
            Loading petitions...
          </div>
        )}

        {!loading && markers.length === 0 && (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "#4a6080",
              fontSize: 13,
            }}
          >
            No petitions scanned in this area yet
          </div>
        )}

        {sorted.map((marker) => {
          const isSelected = selectedMarker?.id === marker.id;
          return (
            <div
              key={marker.id}
              role="option"
              aria-selected={isSelected}
              tabIndex={0}
              onClick={() => onSelect(isSelected ? null : marker)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(isSelected ? null : marker);
                }
              }}
              style={{
                padding: "12px 20px",
                borderBottom: "1px solid #111a28",
                cursor: "pointer",
                background: isSelected
                  ? "rgba(200,168,75,0.08)"
                  : "transparent",
                borderLeft: isSelected
                  ? "2px solid #c8a84b"
                  : "2px solid transparent",
                transition: "all 0.15s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: isSelected ? "#e8dcc8" : "#8a9db5",
                    lineHeight: 1.4,
                    flex: 1,
                  }}
                >
                  {marker.documentType ?? "Petition"} &middot;{" "}
                  {marker.id.substring(0, 8)}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#c8a84b",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {new Date(marker.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 10, color: "#2a4060" }}>
                  {marker.latitude.toFixed(3)}, {marker.longitude.toFixed(3)}
                </span>
              </div>
              {/* Subtle activity bar */}
              <div
                style={{
                  marginTop: 6,
                  height: 2,
                  background: "#1a2535",
                  borderRadius: 1,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: "60%",
                    background: isSelected ? "#c8a84b" : "#4a8fa8",
                    borderRadius: 1,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats Footer */}
      <div
        style={{
          padding: "14px 20px",
          borderTop: "1px solid #1e2d45",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        {[
          {
            label: "Total Petitions",
            value: stats?.totalPetitions?.toLocaleString() ?? "—",
          },
          {
            label: "With Location",
            value: stats?.totalWithLocation?.toLocaleString() ?? "—",
          },
          {
            label: "Recent (7d)",
            value: stats?.recentPetitions?.toLocaleString() ?? "—",
          },
          {
            label: "In View",
            value: markers.length.toLocaleString(),
          },
        ].map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 14, color: "#c8a84b", fontWeight: 600 }}>
              {s.value}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#2a4060",
                letterSpacing: "0.5px",
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
