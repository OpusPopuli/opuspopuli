"use client";

import { useTranslation } from "react-i18next";

interface ConfirmDialogProps {
  readonly message: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Destructive-action confirmation for the /settings/* surfaces.
 *
 * `.on-ink` rather than a literal `bg-ink`: on the Settings surface an opaque
 * ink panel would sit on paper and invert its relationship to the page. on-ink
 * remaps the semantic tokens inside, so the dialog reads as *elevated* in both
 * themes instead of *dark* in one of them. (Plan decision 4, #1069.)
 */
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation("settings");

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={message}
    >
      <div className="bg-surface on-ink border border-line rounded-lg p-6 max-w-sm w-full">
        <p className="text-content mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-surface-alt text-content rounded-lg hover:bg-surface-sunk transition-colors"
          >
            {t("scans.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-danger-solid text-on-danger rounded-lg hover:bg-danger-strong transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
