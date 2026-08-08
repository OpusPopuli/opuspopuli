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
      className="rounded-lg border border-warning-line bg-warning-surface p-5"
      aria-labelledby="no-fields-title"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h2
            id="no-fields-title"
            className="text-base font-semibold text-warning"
          >
            {t("noFieldsMode.title")}
          </h2>
          <p className="text-sm text-warning mt-1">
            {t("noFieldsMode.description")}
          </p>
          {noFieldsMode && (
            <p className="text-sm text-warning mt-2 font-medium">
              {t("noFieldsMode.lockedDescription")}
            </p>
          )}
          {!noFieldsMode && (
            <p className="text-sm text-warning mt-2">
              {t("noFieldsMode.cacheDisclosure")}
            </p>
          )}
        </div>
        <label className="inline-flex items-center gap-3 cursor-pointer shrink-0">
          <span className="text-sm font-medium text-warning">
            {t("noFieldsMode.toggleLabel")}
          </span>
          <input
            type="checkbox"
            checked={noFieldsMode}
            disabled={loading}
            onChange={(e) => {
              void onToggle(e.target.checked);
            }}
            className="w-5 h-5 accent-warning cursor-pointer disabled:opacity-50"
          />
        </label>
      </div>
    </section>
  );
}
