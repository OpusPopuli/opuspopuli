"use client";

import { useEffect, useRef, useState } from "react";

import type { Quad } from "@/lib/vision/perspective";
import { getExclusionBand } from "@/lib/vision/exclusion-band";

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
  /** The privacy notice shown over the discarded band. Translated by the caller. */
  excludedNotice?: string;
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
  excludedNotice = "This area is not captured to protect the privacy of signers",
}: DocumentFrameOverlayProps) {
  const cornerLength = 30;
  const cornerWidth = 3;
  // Green corners + no pulse once ready; otherwise the pale guide that pulses.
  const cornerColor = ready ? "bg-positive-solid" : "bg-paper";
  const pulse = animated && !ready ? "animate-pulse" : "";

  // The band is measured against the element on screen, not the camera frame,
  // so it can be bounded by the guide box the person can actually see. That
  // needs the element's size, which only exists after layout.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasFrame = frameWidth > 0 && frameHeight > 0;

  // The page outline is drawn in RAW FRAME PIXELS with the viewBox set to the
  // frame's own dimensions. It previously normalised to a square 0 0 100 100
  // viewBox, which silently mis-projects any non-square frame — a 720x1280 feed
  // had its unit square stretched onto a square region, so the outline sat well
  // off the real page edges and ran past both sides of the screen.
  const quadPoints =
    quad && hasFrame ? quad.map((p) => `${p.x},${p.y}`).join(" ") : null;

  // Positioned from `getKeepRegion` by way of `getExclusionBand` — the same
  // function `handleCapture` crops with. Drawing it from a separate constant
  // would let the two drift, and the promise that the signature rows are never
  // uploaded would quietly stop being true.
  const band = getExclusionBand({
    quad,
    frameWidth,
    frameHeight,
    containerWidth: size.width,
    containerHeight: size.height,
    padding,
    aspectRatio,
  });

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    >
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
          viewBox={`0 0 ${frameWidth} ${frameHeight}`}
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

      {/*
        The excluded band. Everything below the dashed line is cropped off on
        this device before anything is uploaded — it is where a petition's
        signature rows sit, carrying up to five strangers' handwritten names and
        home addresses. Showing it live is what makes the privacy promise
        checkable rather than merely stated: a person can see the boundary move
        as they frame, and can tell before pressing the shutter whether the
        signatures fall outside it.

        `slice` matches the object-cover <video> beneath, the same as the
        detected-page outline above.
      */}
      {band && (
        <div
          data-testid="exclusion-band"
          className="absolute flex items-start justify-center overflow-hidden bg-black/40"
          style={{
            left: band.left,
            top: band.top,
            width: band.width,
            height: band.height,
            ...(band.clipPath ? { clipPath: band.clipPath } : {}),
            // The hatch marks the area as deliberately withheld rather than
            // merely dark, which a plain dim reads as on a dim petition.
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 10px, rgba(250,250,248,0.14) 10px 11px)",
            borderTop: "2px dashed var(--color-paper)",
          }}
        >
          <p className="px-3 pt-2 text-center text-[11px] font-medium leading-snug text-paper/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {excludedNotice}
          </p>
        </div>
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
