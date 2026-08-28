"use client";

import { useTranslation } from "react-i18next";

interface CaptureControlsProps {
  onCapture: () => void;
  onSwitchCamera?: () => void;
  onToggleTorch?: () => void;
  hasTorch: boolean;
  hasMultipleCameras: boolean;
  torchEnabled: boolean;
  disabled?: boolean;
  /**
   * True when edge detection says the page is framed well enough to capture.
   *
   * This changes the shutter's APPEARANCE ONLY. It must never gate the button:
   * detection fails on shadowed sheets, unusual paper and low light, and a
   * shutter that refuses to fire leaves someone unable to scan a petition that
   * is right in front of them, with no way to tell why.
   */
  ready?: boolean;
}

export function CaptureControls({
  onCapture,
  onSwitchCamera,
  onToggleTorch,
  hasTorch,
  hasMultipleCameras,
  torchEnabled,
  disabled = false,
  ready = false,
}: CaptureControlsProps) {
  const { t } = useTranslation("petition");

  return (
    <div className="absolute bottom-0 left-0 right-0 pb-8 pt-4 flex items-center justify-center gap-8 bg-gradient-to-t from-black/60 to-transparent">
      {/* Torch toggle */}
      <div className="w-12 flex justify-center">
        {hasTorch && onToggleTorch && (
          <button
            onClick={onToggleTorch}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
              torchEnabled
                ? "bg-warning-solid text-black"
                : "bg-paper/20 text-paper"
            }`}
            aria-label={
              torchEnabled
                ? t("camera.controls.flashOff")
                : t("camera.controls.flashOn")
            }
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
      {/*
        Paper ring, gold disc when framed. Gold is earned here in the sense the
        design system means it: a filled shape marking a real state change, not
        decoration — the page is squared up and this shot will read.

        `disabled` is the loading flag only. Readiness deliberately does NOT
        disable it (see the prop doc): detection fails on shadowed sheets and
        poor light, and a shutter that will not fire strands someone holding a
        petition they are entitled to scan.

        Fixed paper/gold rather than theme-relative tokens — the viewfinder is a
        dark scene in both themes, and `bg-surface` would turn the disc black in
        dark mode.
      */}
      <button
        onClick={onCapture}
        disabled={disabled}
        className="w-[72px] h-[72px] rounded-full border-4 border-paper flex items-center justify-center disabled:opacity-50 transition-transform active:scale-95"
        aria-label={t("camera.controls.capture")}
      >
        <div
          className={`w-[60px] h-[60px] rounded-full transition-colors duration-200 ${
            ready ? "bg-accent" : "bg-paper"
          }`}
        />
      </button>

      {/* Camera switch */}
      <div className="w-12 flex justify-center">
        {hasMultipleCameras && onSwitchCamera && (
          <button
            onClick={onSwitchCamera}
            className="w-11 h-11 rounded-full bg-paper/20 text-paper flex items-center justify-center transition-colors"
            aria-label={t("camera.controls.switchCamera")}
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
