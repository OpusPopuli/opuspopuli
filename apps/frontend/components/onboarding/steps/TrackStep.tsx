"use client";

import { useTranslation } from "react-i18next";

export function TrackStep() {
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
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold mb-4">{t("track.title")}</h2>
      <p className="text-white/80">{t("track.description")}</p>
    </div>
  );
}
