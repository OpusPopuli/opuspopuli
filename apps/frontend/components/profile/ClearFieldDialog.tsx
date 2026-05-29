"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface ClearFieldDialogProps {
  readonly open: boolean;
  readonly fieldLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Lightweight confirm dialog for the "Clear value" affordance. Keeps
 * focus inside the dialog while open and restores it to the trigger
 * on close (handled by the caller).
 */
export function ClearFieldDialog({
  open,
  fieldLabel,
  onConfirm,
  onCancel,
}: ClearFieldDialogProps) {
  const { t } = useTranslation("profile");
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-field-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h2
          id="clear-field-title"
          className="text-lg font-bold text-gray-900 mb-2"
        >
          {t("field.clearConfirmTitle")}
        </h2>
        <p className="text-sm text-gray-700 mb-2">
          {t("field.clearConfirmBody")}
        </p>
        <p className="text-sm font-medium text-gray-900 mb-5">{fieldLabel}</p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 rounded-lg"
          >
            {t("field.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            {t("field.clearConfirmAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
