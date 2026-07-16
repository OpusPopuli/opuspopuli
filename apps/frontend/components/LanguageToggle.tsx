"use client";

import { useId } from "react";
import { useMutation } from "@apollo/client/react";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n/context";
import { useToast } from "@/lib/toast";
import { useTranslation } from "react-i18next";
import {
  UPDATE_MY_PROFILE,
  type SupportedLanguage,
  type UpdateMyProfileData,
  type UpdateProfileInput,
} from "@/lib/graphql/profile";

// Two-letter codes intentionally — they're language-agnostic, fit the
// header's tight space, and don't require translating their own labels.
// The sr-only legend below ("Language") is intentionally not translated
// for the same reason WelcomeStep keeps it minimal: screen readers run
// in the user's preferred locale, so a single neutral word reads well
// in either UI language without an i18n round-trip.
const LANGUAGES: { code: SupportedLanguage; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation("common");
  const groupName = useId();
  const [updateProfile] = useMutation<
    UpdateMyProfileData,
    { input: UpdateProfileInput }
  >(UPDATE_MY_PROFILE);

  const handleSelect = (code: SupportedLanguage) => {
    if (code === locale) return;
    setLocale(code);
    // Persist only when authenticated. The UI has already flipped via
    // setLocale; a failed write just means the preference reverts next
    // session, and the toast tells the user.
    if (!isAuthenticated) return;
    updateProfile({
      variables: { input: { preferredLanguage: code } },
    }).catch((err: unknown) => {
      console.warn("Failed to persist preferred language", err);
      showToast(t("errors.preferencesNotSaved"), "warning");
    });
  };

  return (
    <fieldset className="inline-flex bg-surface-alt rounded-full p-0.5 border border-line">
      <legend className="sr-only">{t("languageLegend")}</legend>
      {LANGUAGES.map(({ code, label }) => {
        const active = code === locale;
        return (
          <label
            key={code}
            className={[
              "px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors",
              "focus-within:ring-2 focus-within:ring-accent",
              active
                ? "bg-surface-alt text-white"
                : "text-content-dim hover:text-content ",
            ].join(" ")}
          >
            <input
              type="radio"
              name={groupName}
              value={code}
              checked={active}
              onChange={() => handleSelect(code)}
              className="sr-only"
            />
            {label}
          </label>
        );
      })}
    </fieldset>
  );
}
