"use client";

import { useTranslation } from "react-i18next";

export function WelcomeStep() {
  const { t } = useTranslation("onboarding");

  return (
    <div className="text-center text-white max-w-md">
      <div className="w-24 h-24 bg-white/20 rounded-3xl mx-auto mb-8 flex items-center justify-center">
        <span className="text-4xl font-bold">O</span>
      </div>

      <h1 className="text-3xl font-bold mb-4">{t("welcome.title")}</h1>
      <p className="text-white/80 text-lg">{t("welcome.subtitle")}</p>
    </div>
  );
}
