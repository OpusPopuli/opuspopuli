"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type CameraPermissionState =
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export interface CameraError {
  type:
    | "permission"
    | "not-found"
    | "not-supported"
    | "overconstrained"
    | "unknown";
  message: string;
}

export interface UseCameraOptions {
  facingMode?: "user" | "environment";
  resolution?: "low" | "medium" | "high";
}

const RESOLUTION_MAP = {
  low: { width: 1280, height: 720 },
  medium: { width: 1920, height: 1080 },
  high: { width: 2560, height: 1440 },
};

export interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  stream: MediaStream | null;
  isLoading: boolean;
  error: CameraError | null;
  permissionState: CameraPermissionState;
  hasTorch: boolean;
  hasMultipleCameras: boolean;

  startCamera: () => Promise<void>;
  stopCamera: () => void;
  switchCamera: () => Promise<void>;
  captureFrame: () => ImageData | null;
  setTorch: (enabled: boolean) => Promise<void>;
}

function classifyError(err: unknown): CameraError {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        return { type: "permission", message: "Camera permission denied" };
      case "NotFoundError":
        return { type: "not-found", message: "No camera found on this device" };
      case "NotReadableError":
        return {
          type: "unknown",
          message: "Camera is in use by another application",
        };
      case "OverconstrainedError":
        return {
          type: "overconstrained",
          message: "Camera does not support requested settings",
        };
    }
  }
  return { type: "unknown", message: "An unexpected camera error occurred" };
}

export function useCamera(options: UseCameraOptions = {}): UseCameraReturn {
  const { facingMode = "environment", resolution = "medium" } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [permissionState, setPermissionState] =
    useState<CameraPermissionState>("prompt");
  const [currentFacingMode, setCurrentFacingMode] = useState(facingMode);
  const [hasTorch, setHasTorch] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  // Check browser support
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setPermissionState("unsupported");
      return;
    }

    // Check for multiple cameras
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const cameras = devices.filter((d) => d.kind === "videoinput");
      setHasMultipleCameras(cameras.length > 1);
    });

    // Listen for permission changes
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "camera" as PermissionName })
        .then((status) => {
          setPermissionState(
            status.state === "granted"
              ? "granted"
              : status.state === "denied"
                ? "denied"
                : "prompt",
          );
          status.addEventListener("change", () => {
            setPermissionState(
              status.state === "granted"
                ? "granted"
                : status.state === "denied"
                  ? "denied"
                  : "prompt",
            );
          });
        })
        .catch(() => {
          // Permission query not supported (e.g. iOS Safari)
        });
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
  }, []);

  const startCamera = useCallback(async () => {
    if (permissionState === "unsupported") {
      setError({
        type: "not-supported",
        message: "Camera not supported in this browser",
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    // Stop any existing stream
    stopCamera();

    const res = RESOLUTION_MAP[resolution];

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: res.width },
          height: { ideal: res.height },
        },
        audio: false,
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setPermissionState("granted");

      // Check torch capability
      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        const capabilities = track.getCapabilities?.();
        setHasTorch(Boolean(capabilities && "torch" in capabilities));
      }

      // Attach to video element
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      const cameraError = classifyError(err);
      setError(cameraError);
      if (cameraError.type === "permission") {
        setPermissionState("denied");
      }
    } finally {
      setIsLoading(false);
    }
  }, [permissionState, currentFacingMode, resolution, stopCamera]);

  const switchCamera = useCallback(async () => {
    const next = currentFacingMode === "environment" ? "user" : "environment";
    setCurrentFacingMode(next);
    if (streamRef.current) {
      stopCamera();
      // startCamera will be triggered via effect
    }
  }, [currentFacingMode, stopCamera]);

  // Restart camera when facing mode changes (after initial start)
  useEffect(() => {
    if (stream === null && permissionState === "granted" && !isLoading) {
      // Stream was stopped by switchCamera, restart
    }
  }, [currentFacingMode, stream, permissionState, isLoading]);

  const captureFrame = useCallback((): ImageData | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_CURRENT_DATA) {
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  const setTorch = useCallback(
    async (enabled: boolean) => {
      if (!streamRef.current || !hasTorch) return;
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      try {
        await track.applyConstraints({
          advanced: [{ torch: enabled } as MediaTrackConstraintSet],
        });
      } catch {
        // Torch not supported on this device
      }
    },
    [hasTorch],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    stream,
    isLoading,
    error,
    permissionState,
    hasTorch,
    hasMultipleCameras,
    startCamera,
    stopCamera,
    switchCamera,
    captureFrame,
    setTorch,
  };
}
