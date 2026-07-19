"use client";

import { useEffect, ReactNode } from "react";
import type { ToastMessage, ToastType } from "@/lib/toast";

interface ToastProps {
  readonly toast: ToastMessage;
  readonly onDismiss: () => void;
}

const toastStyles: Record<ToastType, string> = {
  success: "bg-green-600 dark:bg-green-700",
  error: "bg-red-600 dark:bg-red-700",
  warning: "bg-amber-500 dark:bg-amber-600",
  info: "bg-blue-600 dark:bg-blue-700",
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
      className={`${toastStyles[toast.type]} text-white px-4 py-3 rounded-lg max-w-md animate-slide-in`}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0" aria-hidden="true">
          {toastIcons[toast.type]}
        </span>
        <p className="flex-1 text-sm">{toast.message}</p>
        <button
          onClick={onDismiss}
          className="text-white/80 hover:text-white transition-colors flex-shrink-0"
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
