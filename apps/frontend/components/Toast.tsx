"use client";

import { useEffect, ReactNode } from "react";
import type { ToastMessage, ToastType } from "@/lib/toast";

interface ToastProps {
  readonly toast: ToastMessage;
  readonly onDismiss: () => void;
}

const toastStyles: Record<ToastType, string> = {
  success: "bg-positive-solid",
  error: "bg-danger-solid",
  warning: "bg-warning-solid",
  // Not bg-accent: the toast body is paper-on-fill, and paper on gold is
  // ~1.9:1. Gold fills require ink text, which the other three tones don't use.
  info: "bg-info-solid",
};

const toastIcons: Record<ToastType, string> = {
  success: "\u2713", // checkmark
  error: "\u2715", // x mark
  warning: "\u26A0", // warning sign
  info: "\u2139", // info symbol
};

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(onDismiss, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, onDismiss]);

  return (
    <div
      className={`${toastStyles[toast.type]} text-paper px-4 py-3 rounded-lg max-w-md animate-slide-in`}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0" aria-hidden="true">
          {toastIcons[toast.type]}
        </span>
        <p className="flex-1 text-sm">{toast.message}</p>
        {/* Full paper, not paper/80: at 80% the glyph composites to 4.27:1 on
            warning-solid, under AA. Opacity modifiers on TEXT tokens are the
            one place the token contrast guarantees don't hold — dim the whole
            button on hover instead. */}
        <button
          onClick={onDismiss}
          className="text-paper hover:opacity-80 transition-opacity flex-shrink-0"
          aria-label="Close notification"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
    </div>
  );
}

interface ToastContainerProps {
  readonly children: ReactNode;
}

export function ToastContainer({ children }: ToastContainerProps) {
  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {children}
    </div>
  );
}
