"use client";

import { useTranslation } from "react-i18next";

export function ExploreStep() {
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
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold mb-4">{t("explore.title")}</h2>
      <p className="text-white/80 mb-8">{t("explore.description")}</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/10 rounded-xl p-3 text-sm">
          <div className="text-lg mb-1">📋</div>
          <p className="font-medium">{t("explore.features.propositions")}</p>
        </div>
        <div className="bg-white/10 rounded-xl p-3 text-sm">
          <div className="text-lg mb-1">👥</div>
          <p className="font-medium">{t("explore.features.representatives")}</p>
        </div>
        <div className="bg-white/10 rounded-xl p-3 text-sm">
          <div className="text-lg mb-1">🏛️</div>
          <p className="font-medium">{t("explore.features.meetings")}</p>
        </div>
        <div className="bg-white/10 rounded-xl p-3 text-sm">
          <div className="text-lg mb-1">💰</div>
          <p className="font-medium">{t("explore.features.campaignFinance")}</p>
        </div>
      </div>
    </div>
  );
}
