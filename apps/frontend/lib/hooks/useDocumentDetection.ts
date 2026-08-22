"use client";

import { useState, useCallback, useRef } from "react";
import { analyzeFrame } from "@/lib/vision/documentDetection";
import type { Quad } from "@/lib/vision/perspective";

/** What the viewfinder should tell the user to do next. */
export type ReadinessHint =
  | "searching" // no document in view yet
  | "move_closer" // document found but too small in frame
  | "hold_steady" // framed, but not sharp enough
  | "ready"; // good to capture

export interface DocumentReadiness {
  readonly ready: boolean;
  readonly hint: ReadinessHint;
  readonly coverage: number;
  readonly sharpness: number;
  /** Document corners in source video-pixel coords (for overlay + deskew). */
  readonly quad: Quad | null;
  /** Confidence 0..1 in `quad` — capture only deskews above `minConfidence`. */
  readonly confidence: number;
  /** Source frame size, so the overlay can normalise the quad. */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export interface UseDocumentDetectionOptions {
  /** Min fraction of the frame the document must fill to be "ready". */
  minCoverage?: number;
  /** Min variance-of-Laplacian focus score to be "ready". */
  minSharpness?: number;
  /** Min confidence for the capture pipeline to trust the quad for deskew. */
  minConfidence?: number;
  /** Sampling period in ms (analysis is heavier than luminance). */
  sampleInterval?: number;
}

const IDLE: DocumentReadiness = {
  ready: false,
  hint: "searching",
  coverage: 0,
  sharpness: 0,
  quad: null,
  confidence: 0,
  frameWidth: 0,
  frameHeight: 0,
};

/**
 * Classify raw frame metrics into a user-facing readiness hint. Pure so it is
 * unit-testable; thresholds are injected. Note the order: a missing document
 * beats coverage beats sharpness, so the hint always names the *first* thing
 * the user should fix.
 */
export function classifyReadiness(
  metrics: {
    coverage: number;
    sharpness: number;
    hasQuad: boolean;
  },
  minCoverage: number,
  minSharpness: number,
): { ready: boolean; hint: ReadinessHint } {
  if (!metrics.hasQuad || metrics.coverage === 0) {
    return { ready: false, hint: "searching" };
  }
  if (metrics.coverage < minCoverage) {
    return { ready: false, hint: "move_closer" };
  }
  if (metrics.sharpness < minSharpness) {
    return { ready: false, hint: "hold_steady" };
  }
  return { ready: true, hint: "ready" };
}

export interface UseDocumentDetectionReturn {
  readiness: DocumentReadiness;
  /** Latest reading (also mirrored in `readiness`); handy at capture time. */
  latest: () => DocumentReadiness;
  startContinuousAnalysis: (captureFrame: () => ImageData | null) => void;
  stopContinuousAnalysis: () => void;
}

export function useDocumentDetection(
  options: UseDocumentDetectionOptions = {},
): UseDocumentDetectionReturn {
  const {
    minCoverage = 0.4,
    // Focus scores are device/resolution dependent; this floor is deliberately
    // lenient so it never blocks a genuinely-framed document. Tune per device.
    minSharpness = 40,
    minConfidence = 0.35,
    sampleInterval = 350,
  } = options;

  const [readiness, setReadiness] = useState<DocumentReadiness>(IDLE);
  const latestRef = useRef<DocumentReadiness>(IDLE);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analyze = useCallback(
    (frame: ImageData): DocumentReadiness => {
      const a = analyzeFrame(frame);
      const { ready, hint } = classifyReadiness(
        {
          coverage: a.coverage,
          sharpness: a.sharpness,
          hasQuad: a.quad != null,
        },
        minCoverage,
        minSharpness,
      );
      const result: DocumentReadiness = {
        ready,
        hint,
        coverage: a.coverage,
        sharpness: a.sharpness,
        quad: a.confidence >= minConfidence ? a.quad : null,
        confidence: a.confidence,
        frameWidth: frame.width,
        frameHeight: frame.height,
      };
      latestRef.current = result;
      setReadiness(result);
      return result;
    },
    [minCoverage, minSharpness, minConfidence],
  );

  const startContinuousAnalysis = useCallback(
    (captureFrame: () => ImageData | null) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) analyze(frame);
      }, sampleInterval);
    },
    [analyze, sampleInterval],
  );

  const stopContinuousAnalysis = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const latest = useCallback(() => latestRef.current, []);

  return {
    readiness,
    latest,
    startContinuousAnalysis,
    stopContinuousAnalysis,
  };
}
