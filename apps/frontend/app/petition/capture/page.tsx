"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { CameraCapture } from "@/components/camera";

export default function PetitionCapturePage() {
  const router = useRouter();

  const handleConfirm = useCallback(
    (
      imageData: ImageData,
      location?: { latitude: number; longitude: number },
    ) => {
      // TODO: Pass imageData to OCR processing pipeline (Issue #288+)
      // TODO: Call setDocumentLocation mutation with documentId + location (Issue #296)
      // For now, navigate back to petition home
      console.log("Captured image:", imageData.width, "x", imageData.height);
      if (location) {
        console.log("Location:", location.latitude, location.longitude);
      }
      router.push("/petition");
    },
    [router],
  );

  const handleCancel = useCallback(() => {
    router.push("/petition");
  }, [router]);

  return <CameraCapture onConfirm={handleConfirm} onCancel={handleCancel} />;
}
