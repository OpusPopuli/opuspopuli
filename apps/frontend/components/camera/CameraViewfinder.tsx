"use client";

import type { RefObject } from "react";
import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { DocumentFrameOverlay } from "./DocumentFrameOverlay";
import { LightingFeedback } from "./LightingFeedback";
import { CaptureControls } from "./CaptureControls";
import type { LightingLevel } from "@/lib/hooks/useLightingAnalysis";
import {
  useDocumentDetection,
  type ReadinessHint,
} from "@/lib/hooks/useDocumentDetection";
import { deskewImageData } from "@/lib/vision/perspective";
import { getKeepRegion, cropImageData } from "@/lib/vision/signature-region";

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
  onCancel?: () => void;
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
  onCancel,
}: CameraViewfinderProps) {
  const { t } = useTranslation("petition");
  const detection = useDocumentDetection();

  const guideTextForHint = (hint: ReadinessHint): string =>
    ({
      searching: t("camera.guide.searching"),
      move_closer: t("camera.guide.moveCloser"),
      hold_steady: t("camera.guide.holdSteady"),
      ready: t("camera.guide.ready"),
    })[hint];

  // Attach the stream to the <video> once BOTH exist. useCamera.startCamera()
  // runs during the permission step, before this viewfinder's <video> mounts,
  // so its one-shot `video.srcObject = stream` assignment is skipped (the ref
  // is still null) — leaving a live track (torch works) but no feed and no
  // frames to capture (dead shutter). Attaching here, after mount, is race-free.
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream && video.srcObject !== stream) {
      // Guard the attach: assigning a value the browser rejects as a
      // MediaStream (e.g. a mocked stream in E2E) throws synchronously here,
      // and an uncaught throw in an effect can unmount the whole subtree — the
      // page then renders blank. A failed attach should degrade to "no feed",
      // never crash the viewfinder.
      try {
        video.srcObject = stream;
        // iOS Safari won't always autoplay a freshly-attached stream; nudge it.
        // play() returns a Promise in browsers but undefined under jsdom.
        video.play()?.catch(() => {});
      } catch {
        // No feed; capture falls back to whatever the video can provide.
      }
    }
  }, [stream, videoRef]);

  // Start continuous lighting + document analysis when the stream is active.
  const {
    startContinuousAnalysis: startDocAnalysis,
    stopContinuousAnalysis: stopDocAnalysis,
  } = detection;
  useEffect(() => {
    if (stream) {
      startContinuousAnalysis(captureFrame);
      startDocAnalysis(captureFrame);
      return () => {
        stopContinuousAnalysis();
        stopDocAnalysis();
      };
    }
  }, [
    stream,
    captureFrame,
    startContinuousAnalysis,
    stopContinuousAnalysis,
    startDocAnalysis,
    stopDocAnalysis,
  ]);

  const handleCapture = useCallback(() => {
    const frame = captureFrame();
    if (!frame) return;
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
    // Deskew-crop to the detected document when we have a confident quad;
    // otherwise send the full frame. Cropping to the document removes the
    // background/skew, which is the biggest lever on OCR quality — and the
    // fallback guarantees we never do worse than the whole frame.
    const { quad } = detection.latest();
    const deskewed = quad ? (deskewImageData(frame, quad) ?? frame) : frame;
    const pageFillsImage = deskewed !== frame;

    // Then drop the signature block (#1075). This happens HERE, next to the
    // deskew, because this is the only place that knows whether the deskew
    // succeeded — and the answer changes the crop. After a successful deskew
    // the image IS the page, so we keep the top of the image; without one the
    // quad still refers to frame coordinates and we fall back conservatively.
    //
    // Doing it here also means the discarded pixels never reach sessionStorage,
    // the network, object storage or OCR. Those five strangers' names and
    // addresses simply never leave the phone.
    const keep = getKeepRegion({
      quad: pageFillsImage ? null : quad,
      frameWidth: deskewed.width,
      frameHeight: deskewed.height,
      pageFillsImage,
    });

    onCapture(cropImageData(deskewed, keep));
  }, [captureFrame, onCapture, detection]);

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

      {/* Close / cancel — the viewfinder's only way out of the camera */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("camera.controls.close")}
          className="absolute top-4 left-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper"
          style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
        >
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}

      <DocumentFrameOverlay
        ready={detection.readiness.ready}
        quad={detection.readiness.quad}
        frameWidth={detection.readiness.frameWidth}
        frameHeight={detection.readiness.frameHeight}
        guideText={guideTextForHint(detection.readiness.hint)}
      />

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
