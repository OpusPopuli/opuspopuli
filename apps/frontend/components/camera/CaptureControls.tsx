"use client";

interface CaptureControlsProps {
  onCapture: () => void;
  onSwitchCamera?: () => void;
  onToggleTorch?: () => void;
  hasTorch: boolean;
  hasMultipleCameras: boolean;
  torchEnabled: boolean;
  disabled?: boolean;
}

export function CaptureControls({
  onCapture,
  onSwitchCamera,
  onToggleTorch,
  hasTorch,
  hasMultipleCameras,
  torchEnabled,
  disabled = false,
}: CaptureControlsProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 pb-8 pt-4 flex items-center justify-center gap-8 bg-gradient-to-t from-black/60 to-transparent">
      {/* Torch toggle */}
      <div className="w-12 flex justify-center">
        {hasTorch && onToggleTorch && (
          <button
            onClick={onToggleTorch}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
              torchEnabled
                ? "bg-yellow-500 text-black"
                : "bg-white/20 text-white"
            }`}
            aria-label={torchEnabled ? "Turn off flash" : "Turn on flash"}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Capture button */}
      <button
        onClick={onCapture}
        disabled={disabled}
        className="w-[72px] h-[72px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-50 transition-transform active:scale-95"
        aria-label="Capture photo"
      >
        <div className="w-[60px] h-[60px] rounded-full bg-white" />
      </button>

      {/* Camera switch */}
      <div className="w-12 flex justify-center">
        {hasMultipleCameras && onSwitchCamera && (
          <button
            onClick={onSwitchCamera}
            className="w-11 h-11 rounded-full bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="Switch camera"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
