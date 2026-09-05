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
  { code: "en", labelKey: "language.en" },
  { code: "es", labelKey: "language.es" },
];

/**
 * The EN/ES chooser, extracted from the welcome screen that used to carry it.
 *
 * It has to appear on whichever screen comes first, and it has to appear
 * before anything asks the reader to read: a Spanish speaker who lands on an
 * English form has already been asked to work before being offered the
 * choice. When the welcome screen was removed this moved to the first step
 * rather than being dropped with it.
 */
export function LanguageChoice({ className }: { className?: string }) {
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
    // Fire-and-forget persistence. Client-side setLocale already updated the
    // UI; a failed mutation must not block onboarding. The toast surfaces the
    // inconsistency to the reader; warn so it's debuggable in dev.
    updateProfile({ variables: { input: { preferredLanguage: code } } }).catch(
      (err: unknown) => {
        console.warn("Failed to persist preferred language", err);
        showToast(tc("errors.preferencesNotSaved"), "warning");
      },
    );
  };

  return (
    <fieldset
      className={`inline-flex rounded-full border border-line bg-surface p-1 ${className ?? ""}`}
    >
      <legend className="sr-only">{t("language.legend")}</legend>
      {LANGUAGES.map(({ code, labelKey }) => {
        const active = code === locale;
        return (
          <label
            key={code}
            className={[
              "cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              "focus-within:ring-2 focus-within:ring-accent",
              active
                ? "bg-inverse-surface text-on-inverse"
                : "text-content-dim hover:text-content",
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
  );
}
