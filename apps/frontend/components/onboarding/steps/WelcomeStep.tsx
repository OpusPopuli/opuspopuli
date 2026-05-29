"use client";

import { useTranslation } from "react-i18next";
import { useMutation } from "@apollo/client/react";
import { useLocale } from "@/lib/i18n/context";
import {
  UPDATE_MY_PROFILE,
  type SupportedLanguage,
  type UpdateProfileInput,
  type UpdateMyProfileData,
} from "@/lib/graphql/profile";

const LANGUAGES: { code: SupportedLanguage; labelKey: string }[] = [
  { code: "en", labelKey: "welcome.languages.en" },
  { code: "es", labelKey: "welcome.languages.es" },
];

export function WelcomeStep() {
  const { t } = useTranslation("onboarding");
  const { locale, setLocale } = useLocale();
  const [updateProfile] = useMutation<
    UpdateMyProfileData,
    { input: UpdateProfileInput }
  >(UPDATE_MY_PROFILE);

  const handleLocale = (code: SupportedLanguage) => {
    if (code === locale) return;
    setLocale(code);
    // Fire-and-forget persistence. Client-side setLocale already
    // updated the UI; a failed mutation must not block onboarding. If
    // the persist fails the locale lives client-side only and reverts
    // on next visit — log so the inconsistency is debuggable rather
    // than silent.
    updateProfile({ variables: { input: { preferredLanguage: code } } }).catch(
      (err: unknown) => {
        console.warn("Failed to persist preferred language", err);
      },
    );
  };

  return (
    <div className="text-center text-white max-w-md">
      <div className="w-24 h-24 bg-white/20 rounded-3xl mx-auto mb-8 flex items-center justify-center">
        <span className="text-4xl font-bold">O</span>
      </div>

      <h1 className="text-3xl font-bold mb-4">{t("welcome.title")}</h1>
      <p className="text-white/80 text-lg mb-8">{t("welcome.subtitle")}</p>

      <fieldset className="inline-flex bg-white/10 rounded-full p-1 border border-white/20">
        <legend className="sr-only">{t("welcome.languageLegend")}</legend>
        {LANGUAGES.map(({ code, labelKey }) => {
          const active = code === locale;
          return (
            <label
              key={code}
              className={[
                "px-4 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-colors",
                "focus-within:ring-2 focus-within:ring-white",
                active
                  ? "bg-white text-[#2D4A3C]"
                  : "text-white/80 hover:text-white",
              ].join(" ")}
            >
              <input
                type="radio"
                name="onboarding-locale"
                value={code}
                checked={active}
                onChange={() => handleLocale(code)}
                className="sr-only"
              />
              {t(labelKey)}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
