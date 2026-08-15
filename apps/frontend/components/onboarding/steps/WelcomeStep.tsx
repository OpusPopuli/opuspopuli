"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@apollo/client/react";
import { useLocale } from "@/lib/i18n/context";
import { useToast } from "@/lib/toast";
import { Sunflower } from "@/components/brand/Sunflower";
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
      {/*
        The brand mark, not a placeholder. This was a dark rounded square with
        a letter "O" — the first thing a new account ever saw, and the only
        screen in the product still showing it.

        `state="idle"` gives the sway animation the header already uses, and
        the component respects prefers-reduced-motion.

        Deliberately UNtitled, unlike the header's mark. Without a `title` the
        component renders aria-hidden, which is what we want here: the h1 below
        already names the screen, so labelling this would make a screen reader
        announce the brand twice before reaching the actual content. The
        onboarding a11y suite enforces exactly that — every SVG on a step must
        be decorative.
      */}
      <div className="mx-auto mb-8 flex w-24 items-center justify-center">
        <Sunflower state="idle" size={96} />
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
