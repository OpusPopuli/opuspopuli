"use client";

import type { RefObject } from "react";
import { useEffect, useCallback } from "react";
import { DocumentFrameOverlay } from "./DocumentFrameOverlay";
import { LightingFeedback } from "./LightingFeedback";
import { CaptureControls } from "./CaptureControls";
import type { LightingLevel } from "@/lib/hooks/useLightingAnalysis";

interface CameraViewfinderProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stream: MediaStream | null;
  isLoading: boolean;
  hasTorch: boolean;
  hasMultipleCameras: boolean;
  lightingLevel: LightingLevel;
  torchEnabled: boolean;
  captureFrame: () => ImageData | null;
  switchCamera: () => Promise<void>;
  startContinuousAnalysis: (captureFrame: () => ImageData | null) => void;
  stopContinuousAnalysis: () => void;
  onCapture: (imageData: ImageData) => void;
  onToggleTorch: () => void;
}

export function CameraViewfinder({
  videoRef,
  canvasRef,
  stream,
  isLoading,
  hasTorch,
  hasMultipleCameras,
  lightingLevel,
  torchEnabled,
  captureFrame,
  switchCamera,
  startContinuousAnalysis,
  stopContinuousAnalysis,
  onCapture,
  onToggleTorch,
}: CameraViewfinderProps) {
  // Start continuous lighting analysis when stream is active
  useEffect(() => {
    if (stream) {
      startContinuousAnalysis(captureFrame);
      return () => stopContinuousAnalysis();
    }
  }, [stream, captureFrame, startContinuousAnalysis, stopContinuousAnalysis]);

  const handleCapture = useCallback(() => {
    const frame = captureFrame();
    if (frame) {
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      onCapture(frame);
    }
  }, [captureFrame, onCapture]);

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />

      <canvas ref={canvasRef} className="hidden" />

      <DocumentFrameOverlay />

      <LightingFeedback level={lightingLevel} />

      <CaptureControls
        onCapture={handleCapture}
        onSwitchCamera={switchCamera}
        onToggleTorch={onToggleTorch}
        hasTorch={hasTorch}
        hasMultipleCameras={hasMultipleCameras}
        torchEnabled={torchEnabled}
        disabled={isLoading}
      />
    </div>
  );
}
