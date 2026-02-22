"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { CameraCapture } from "@/components/camera";

/**
 * Convert ImageData (raw pixels from camera) to a base64-encoded PNG string.
 * Uses an offscreen canvas to re-encode the pixel data.
 */
function imageDataToBase64(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  // Strip the data URL prefix to get raw base64
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

export default function PetitionCapturePage() {
  const router = useRouter();

  const handleConfirm = useCallback(
    (
      imageData: ImageData,
      location?: { latitude: number; longitude: number },
    ) => {
      try {
        const base64 = imageDataToBase64(imageData);
        sessionStorage.setItem("petition-scan-data", base64);
        if (location) {
          sessionStorage.setItem(
            "petition-scan-location",
            JSON.stringify(location),
          );
        } else {
          sessionStorage.removeItem("petition-scan-location");
        }
        router.push("/petition/results");
      } catch (error) {
        console.error("Failed to process captured image:", error);
        router.push("/petition");
      }
    },
    [router],
  );

  const handleCancel = useCallback(() => {
    router.push("/petition");
  }, [router]);

  return <CameraCapture onConfirm={handleConfirm} onCancel={handleCancel} />;
}
