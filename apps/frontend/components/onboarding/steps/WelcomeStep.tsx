"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@apollo/client/react";
import { useLocale } from "@/lib/i18n/context";
import { useToast } from "@/lib/toast";
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
  const { t: tc } = useTranslation("common");
  const { locale, setLocale } = useLocale();
  const { showToast } = useToast();
  const groupName = useId();
  const [updateProfile] = useMutation<
    UpdateMyProfileData,
    { input: UpdateProfileInput }
  >(UPDATE_MY_PROFILE);

  const handleLocale = (code: SupportedLanguage) => {
    if (code === locale) return;
    setLocale(code);
    // Fire-and-forget persistence. Client-side setLocale already updated
    // the UI; a failed mutation must not block onboarding. Toast surfaces
    // the inconsistency to the user; warn so it's debuggable in dev.
    updateProfile({ variables: { input: { preferredLanguage: code } } }).catch(
      (err: unknown) => {
        console.warn("Failed to persist preferred language", err);
        showToast(tc("errors.preferencesNotSaved"), "warning");
      },
    );
  };

  return (
    <div className="text-center max-w-md">
      <div className="w-24 h-24 bg-inverse-surface text-on-inverse rounded-lg mx-auto mb-8 flex items-center justify-center">
        <span className="text-4xl font-bold">O</span>
      </div>

      <h1 className="text-3xl font-bold mb-4 text-content">
        {t("welcome.title")}
      </h1>
      <p className="text-content-dim text-lg mb-8">{t("welcome.subtitle")}</p>

      <fieldset className="inline-flex bg-surface rounded-full p-1 border border-line">
        <legend className="sr-only">{t("welcome.languageLegend")}</legend>
        {LANGUAGES.map(({ code, labelKey }) => {
          const active = code === locale;
          return (
            <label
              key={code}
              className={[
                "px-4 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-colors",
                "focus-within:ring-2 focus-within:ring-accent",
                active
                  ? "bg-inverse-surface text-on-inverse"
                  : "text-content-dim hover:text-content ",
              ].join(" ")}
            >
              <input
                type="radio"
                name={groupName}
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
