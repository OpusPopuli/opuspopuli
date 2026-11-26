"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import i18n, { SupportedLanguage, supportedLanguages } from "./index";
import { GET_MY_PROFILE, MyProfileData } from "@/lib/graphql/profile";
import { useAuth } from "@/lib/auth-context";

interface I18nContextType {
  locale: SupportedLanguage;
  setLocale: (locale: SupportedLanguage) => void;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

interface I18nProviderProps {
  readonly children: ReactNode;
}

export function I18nProvider({ children }: Readonly<I18nProviderProps>) {
  const { t } = useTranslation("common");
  const [userOverride, setUserOverride] = useState<SupportedLanguage | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const isInitialMount = useRef(true);
  // The saved language preference lives on the account. A visitor has none,
  // and asking would send an account-only query from every page, which a
  // signed-out reader of the open civic record (#1456) must never do.
  const { isAuthenticated } = useAuth();
  const { data } = useQuery<MyProfileData>(GET_MY_PROFILE, {
    skip: !isAuthenticated,
  });

  // Derive locale from profile or user override (no setState in effect)
  const profileLanguage = data?.myProfile?.preferredLanguage;
  const locale = useMemo<SupportedLanguage>(() => {
    // User override takes precedence
    if (userOverride) {
      return userOverride;
    }
    // Then profile preference
    if (
      profileLanguage &&
      supportedLanguages.includes(profileLanguage as SupportedLanguage)
    ) {
      return profileLanguage as SupportedLanguage;
    }
    // Default to English
    return "en";
  }, [userOverride, profileLanguage]);

  // Update i18n and document lang when locale changes
  useEffect(() => {
    if (i18n.language !== locale) {
      i18n.changeLanguage(locale);
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
    // Announce language change to screen readers (skip initial mount)
    if (!isInitialMount.current) {
      // Small delay to ensure translation is loaded
      setTimeout(() => {
        setAnnouncement(t("accessibility.languageChanged"));
      }, 100);
    }
    isInitialMount.current = false;
  }, [locale, t]);

  const setLocale = useCallback((newLocale: SupportedLanguage) => {
    if (supportedLanguages.includes(newLocale)) {
      setUserOverride(newLocale);
    }
  }, []);

  const contextValue = useMemo(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
      {/* Visually hidden live region for screen reader announcements */}
      <output
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {announcement}
      </output>
    </I18nContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("useLocale must be used within an I18nProvider");
  }
  return context;
}
