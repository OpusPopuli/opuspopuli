"use client";

import { useState, useCallback, useRef } from "react";

export type LightingLevel = "dark" | "good" | "bright";

export interface LightingAnalysis {
  level: LightingLevel;
  luminance: number;
}

export interface UseLightingAnalysisOptions {
  darkThreshold?: number;
  brightThreshold?: number;
  sampleInterval?: number;
}

export interface UseLightingAnalysisReturn {
  analysis: LightingAnalysis;
  analyze: (imageData: ImageData) => LightingAnalysis;
  startContinuousAnalysis: (captureFrame: () => ImageData | null) => void;
  stopContinuousAnalysis: () => void;
}

function computeLuminance(imageData: ImageData): number {
  const pixels = imageData.data;
  let totalLuminance = 0;

  // Sample every 16th pixel for performance
  const step = 16 * 4;
  let sampleCount = 0;

  for (let i = 0; i < pixels.length; i += step) {
    totalLuminance +=
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    sampleCount++;
  }

  return sampleCount > 0 ? totalLuminance / sampleCount : 0;
}

function classifyLighting(
  luminance: number,
  darkThreshold: number,
  brightThreshold: number,
): LightingLevel {
  if (luminance < darkThreshold) return "dark";
  if (luminance > brightThreshold) return "bright";
  return "good";
}

export function useLightingAnalysis(
  options: UseLightingAnalysisOptions = {},
): UseLightingAnalysisReturn {
  const {
    darkThreshold = 50,
    brightThreshold = 200,
    sampleInterval = 500,
  } = options;

  const [analysis, setAnalysis] = useState<LightingAnalysis>({
    level: "good",
    luminance: 128,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analyze = useCallback(
    (imageData: ImageData): LightingAnalysis => {
      const luminance = computeLuminance(imageData);
      const level = classifyLighting(luminance, darkThreshold, brightThreshold);
      const result = { level, luminance };
      setAnalysis(result);
      return result;
    },
    [darkThreshold, brightThreshold],
  );

  const startContinuousAnalysis = useCallback(
    (captureFrame: () => ImageData | null) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) {
          analyze(frame);
        }
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

  return {
    analysis,
    analyze,
    startContinuousAnalysis,
    stopContinuousAnalysis,
  };
}
