"use client";

import { useTranslation } from "react-i18next";

interface NoFieldsModePanelProps {
  readonly noFieldsMode: boolean;
  readonly onToggle: (next: boolean) => Promise<void>;
  readonly loading?: boolean;
}

export function NoFieldsModePanel({
  noFieldsMode,
  onToggle,
  loading,
}: NoFieldsModePanelProps) {
  const { t } = useTranslation("profile");
  return (
    <section
      className="rounded-lg border border-amber-300 bg-amber-50 p-5"
      aria-labelledby="no-fields-title"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h2
            id="no-fields-title"
            className="text-base font-semibold text-amber-900"
          >
            {t("noFieldsMode.title")}
          </h2>
          <p className="text-sm text-amber-900/80 mt-1">
            {t("noFieldsMode.description")}
          </p>
          {noFieldsMode && (
            <p className="text-sm text-amber-900/80 mt-2 font-medium">
              {t("noFieldsMode.lockedDescription")}
            </p>
          )}
          {!noFieldsMode && (
            <p className="text-xs text-amber-900 mt-2">
              {t("noFieldsMode.cacheDisclosure")}
            </p>
          )}
        </div>
        <label className="inline-flex items-center gap-3 cursor-pointer shrink-0">
          <span className="text-sm font-medium text-amber-900">
            {t("noFieldsMode.toggleLabel")}
          </span>
          <input
            type="checkbox"
            checked={noFieldsMode}
            disabled={loading}
            onChange={(e) => {
              void onToggle(e.target.checked);
            }}
            className="w-5 h-5 accent-amber-700 cursor-pointer disabled:opacity-50"
          />
        </label>
      </div>
    </section>
  );
}
