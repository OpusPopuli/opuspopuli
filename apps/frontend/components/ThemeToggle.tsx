"use client";

import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme-context";

// Sun (light) / moon (dark) toggle. Sits beside LanguageToggle in the header.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation("common");
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className="p-2 text-content-dim transition-colors hover:text-content"
      aria-label={t("theme.toggle")}
      title={t(isDark ? "theme.light" : "theme.dark")}
    >
      {isDark ? (
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36 6.36l-1.42-1.42M6.34 6.34L4.93 4.93m12.73 0l-1.42 1.42M6.34 17.66l-1.41 1.41M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ) : (
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
    </button>
  );
}
