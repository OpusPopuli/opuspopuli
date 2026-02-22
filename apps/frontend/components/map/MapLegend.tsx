"use client";

export function MapLegend() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 28,
        left: 28,
        background: "rgba(10,15,26,0.88)",
        border: "1px solid #1e2d45",
        borderRadius: 6,
        padding: "12px 16px",
        fontSize: 11,
        fontFamily: "'Georgia', serif",
        zIndex: 20,
      }}
    >
      <div
        style={{
          color: "#4a6080",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Legend
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "rgba(74,143,168,0.85)",
            border: "1px solid #8fcfe8",
          }}
        />
        <span style={{ color: "#8a9db5" }}>Petition location</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "rgba(200,168,75,0.85)",
            border: "1px solid #f0d070",
          }}
        />
        <span style={{ color: "#8a9db5" }}>Selected petition</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "rgba(74,143,168,0.4)",
            border: "1px solid #4a8fa8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 8,
            color: "white",
            fontWeight: "bold",
            fontFamily: "sans-serif",
          }}
        >
          5
        </div>
        <span style={{ color: "#8a9db5" }}>Cluster (count)</span>
      </div>
    </div>
  );
}
