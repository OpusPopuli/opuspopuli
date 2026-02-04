"use client";

import { useRef, useEffect } from "react";

interface CapturePreviewProps {
  imageData: ImageData;
  onRetake: () => void;
  onConfirm: () => void;
  isProcessing?: boolean;
}

export function CapturePreview({
  imageData,
  onRetake,
  onConfirm,
  isProcessing = false,
}: CapturePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = imageData.width;
    canvas.height = imageData.height;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.putImageData(imageData, 0, 0);
    }
  }, [imageData]);

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      {/* Preview image */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {/* Action buttons */}
      <div className="px-6 pb-8 pt-4 flex items-center justify-center gap-4 bg-gradient-to-t from-black/60 to-transparent">
        <button
          onClick={onRetake}
          disabled={isProcessing}
          className="flex-1 max-w-[160px] py-3 bg-white/20 text-white font-medium rounded-lg transition-colors hover:bg-white/30 disabled:opacity-50"
        >
          Retake
        </button>
        <button
          onClick={onConfirm}
          disabled={isProcessing}
          className="flex-1 max-w-[160px] py-3 bg-blue-600 text-white font-medium rounded-lg transition-colors hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
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
              Processing
            </>
          ) : (
            "Use Photo"
          )}
        </button>
      </div>
    </div>
  );
}
