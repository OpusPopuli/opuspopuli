"use client";

import { useState, useCallback } from "react";
import { useCamera } from "@/lib/hooks/useCamera";
import { useLightingAnalysis } from "@/lib/hooks/useLightingAnalysis";
import { CameraPermission } from "./CameraPermission";
import { CameraViewfinder } from "./CameraViewfinder";
import { CapturePreview } from "./CapturePreview";

type CaptureStep = "permission" | "capture" | "preview";

interface CameraCaptureProps {
  onConfirm: (imageData: ImageData) => void;
  onCancel?: () => void;
}

export function CameraCapture({ onConfirm, onCancel }: CameraCaptureProps) {
  const camera = useCamera({ facingMode: "environment", resolution: "high" });
  const lighting = useLightingAnalysis();

  const [step, setStep] = useState<CaptureStep>(
    camera.permissionState === "granted" ? "capture" : "permission",
  );
  const [capturedImage, setCapturedImage] = useState<ImageData | null>(null);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRequestPermission = useCallback(async () => {
    await camera.startCamera();
    setStep("capture");
  }, [camera]);

  const handleCapture = useCallback(
    (imageData: ImageData) => {
      setCapturedImage(imageData);
      lighting.stopContinuousAnalysis();
      setStep("preview");
    },
    [lighting],
  );

  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setStep("capture");
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!capturedImage) return;
    setIsProcessing(true);
    try {
      onConfirm(capturedImage);
    } finally {
      setIsProcessing(false);
    }
  }, [capturedImage, onConfirm]);

  const handleToggleTorch = useCallback(async () => {
    const next = !torchEnabled;
    await camera.setTorch(next);
    setTorchEnabled(next);
  }, [torchEnabled, camera]);

  // Show error state
  if (camera.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center bg-black text-white">
        <svg
          className="w-16 h-16 mb-6 text-red-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
        <h2 className="text-xl font-semibold mb-2">Camera Error</h2>
        <p className="text-gray-400 mb-6 max-w-sm">{camera.error.message}</p>
        <div className="flex gap-3">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Go Back
            </button>
          )}
          <button
            onClick={handleRequestPermission}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Permission request
  if (step === "permission" && camera.permissionState !== "granted") {
    return (
      <CameraPermission
        state={camera.permissionState}
        onRequestPermission={handleRequestPermission}
      />
    );
  }

  // Loading state
  if (camera.isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-black">
        <svg
          className="w-8 h-8 text-white animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
    );
  }

  // Preview
  if (step === "preview" && capturedImage) {
    return (
      <CapturePreview
        imageData={capturedImage}
        onRetake={handleRetake}
        onConfirm={handleConfirm}
        isProcessing={isProcessing}
      />
    );
  }

  // Viewfinder
  return (
    <CameraViewfinder
      videoRef={camera.videoRef}
      canvasRef={camera.canvasRef}
      stream={camera.stream}
      isLoading={camera.isLoading}
      hasTorch={camera.hasTorch}
      hasMultipleCameras={camera.hasMultipleCameras}
      lightingLevel={lighting.analysis.level}
      torchEnabled={torchEnabled}
      captureFrame={camera.captureFrame}
      switchCamera={camera.switchCamera}
      startContinuousAnalysis={lighting.startContinuousAnalysis}
      stopContinuousAnalysis={lighting.stopContinuousAnalysis}
      onCapture={handleCapture}
      onToggleTorch={handleToggleTorch}
    />
  );
}
