"use client";

import { useTranslation } from "react-i18next";

export function AnalyzeStep() {
  const { t } = useTranslation("onboarding");

  return (
    <div className="text-center text-white max-w-md">
      <div className="w-20 h-20 bg-white/20 rounded-2xl mx-auto mb-8 flex items-center justify-center">
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
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold mb-4">{t("analyze.title")}</h2>
      <p className="text-white/80">{t("analyze.description")}</p>
    </div>
  );
}
