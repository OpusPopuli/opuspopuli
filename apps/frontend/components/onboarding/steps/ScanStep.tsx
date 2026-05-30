"use client";

import { useTranslation } from "react-i18next";

export function ScanStep() {
  const { t } = useTranslation("onboarding");

  return (
    <div className="text-center max-w-md">
      <div className="w-20 h-20 bg-sage-light/30 dark:bg-sage-dark/20 text-sage-dark dark:text-sage-light rounded-2xl mx-auto mb-8 flex items-center justify-center">
        <svg
          className="w-10 h-10"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
        {t("scan.title")}
      </h2>
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        {t("scan.description")}
      </p>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-sm text-gray-600 dark:text-gray-300">
        <p>{t("scan.permissionNote")}</p>
      </div>
    </div>
  );
}
