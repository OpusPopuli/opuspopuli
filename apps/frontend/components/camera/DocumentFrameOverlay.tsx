"use client";

import type { Quad } from "@/lib/vision/perspective";

interface DocumentFrameOverlayProps {
  aspectRatio?: number;
  padding?: number;
  animated?: boolean;
  /** Turns the guide green and stops the pulse when the frame is capture-ready. */
  ready?: boolean;
  /** Detected document corners in source video-pixel coords (drawn as an outline). */
  quad?: Quad | null;
  /** Source frame size, so the quad can be normalised to the overlay. */
  frameWidth?: number;
  frameHeight?: number;
  /** Instruction shown under the frame ("Move closer", "Ready", …). */
  guideText?: string;
}

export function DocumentFrameOverlay({
  aspectRatio = 8.5 / 11,
  padding = 32,
  animated = true,
  ready = false,
  quad = null,
  frameWidth = 0,
  frameHeight = 0,
  guideText = "Align petition within the frame",
}: DocumentFrameOverlayProps) {
  const cornerLength = 30;
  const cornerWidth = 3;
  // Green corners + no pulse once ready; otherwise the pale guide that pulses.
  const cornerColor = ready ? "bg-positive-solid" : "bg-paper";
  const pulse = animated && !ready ? "animate-pulse" : "";

  // Normalise the detected quad to the 0..100 viewBox. The outline SVG uses
  // `slice` so it aligns with the object-cover <video> underneath.
  const quadPoints =
    quad && frameWidth > 0 && frameHeight > 0
      ? quad
          .map(
            (p) => `${(p.x / frameWidth) * 100},${(p.y / frameHeight) * 100}`,
          )
          .join(" ")
      : null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <svg
        className="w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <mask id="frame-mask">
            <rect width="100" height="100" fill="white" />
            <rect
              x={`${padding / 4}`}
              y={`${(100 - (100 - padding / 2) * (1 / aspectRatio)) / 2}`}
              width={`${100 - padding / 2}`}
              height={`${(100 - padding / 2) / aspectRatio}`}
              fill="black"
              rx="1"
            />
          </mask>
        </defs>
        <rect
          width="100"
          height="100"
          fill="black"
          fillOpacity="0.5"
          mask="url(#frame-mask)"
        />
      </svg>

      {/* Detected document outline — tracks the real edges, green when ready. */}
      {quadPoints && (
        <svg
          className={`absolute inset-0 w-full h-full ${ready ? "text-positive" : "text-accent"}`}
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
        >
          <polygon
            points={quadPoints}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      {/* Corner brackets positioned via CSS for pixel-perfect rendering */}
      <div
        className="absolute"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: `calc(100% - ${padding * 2}px)`,
          aspectRatio: `${aspectRatio}`,
          maxHeight: `calc(100% - ${padding * 2}px)`,
        }}
      >
        {/* Top-left corner */}
        <div className={`absolute top-0 left-0 ${pulse}`}>
          <div
            className={`absolute top-0 left-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerLength}px`, height: `${cornerWidth}px` }}
          />
          <div
            className={`absolute top-0 left-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerWidth}px`, height: `${cornerLength}px` }}
          />
        </div>

        {/* Top-right corner */}
        <div className={`absolute top-0 right-0 ${pulse}`}>
          <div
            className={`absolute top-0 right-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerLength}px`, height: `${cornerWidth}px` }}
          />
          <div
            className={`absolute top-0 right-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerWidth}px`, height: `${cornerLength}px` }}
          />
        </div>

        {/* Bottom-left corner */}
        <div className={`absolute bottom-0 left-0 ${pulse}`}>
          <div
            className={`absolute bottom-0 left-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerLength}px`, height: `${cornerWidth}px` }}
          />
          <div
            className={`absolute bottom-0 left-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerWidth}px`, height: `${cornerLength}px` }}
          />
        </div>

        {/* Bottom-right corner */}
        <div className={`absolute bottom-0 right-0 ${pulse}`}>
          <div
            className={`absolute bottom-0 right-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerLength}px`, height: `${cornerWidth}px` }}
          />
          <div
            className={`absolute bottom-0 right-0 ${cornerColor} rounded-full`}
            style={{ width: `${cornerWidth}px`, height: `${cornerLength}px` }}
          />
        </div>

        {/* Guide text */}
        <div className="absolute -bottom-8 left-0 right-0 text-center">
          <span
            className={`text-sm font-medium drop-shadow-lg ${ready ? "text-positive" : "text-paper"}`}
          >
            {guideText}
          </span>
        </div>
      </div>
    </div>
  );
}
