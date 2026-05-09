import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en/common.json";
import enSettings from "@/locales/en/settings.json";
import enOnboarding from "@/locales/en/onboarding.json";
import enPetition from "@/locales/en/petition.json";
import enLanding from "@/locales/en/landing.json";
import enCivics from "@/locales/en/civics.json";
import esCommon from "@/locales/es/common.json";
import esSettings from "@/locales/es/settings.json";
import esOnboarding from "@/locales/es/onboarding.json";
import esPetition from "@/locales/es/petition.json";
import esLanding from "@/locales/es/landing.json";
import esCivics from "@/locales/es/civics.json";

export const defaultNS = "common";
export const supportedLanguages = ["en", "es"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    onboarding: enOnboarding,
    petition: enPetition,
    landing: enLanding,
    civics: enCivics,
  },
  es: {
    common: esCommon,
    settings: esSettings,
    onboarding: esOnboarding,
    petition: esPetition,
    landing: esLanding,
    civics: esCivics,
  },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS,
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
