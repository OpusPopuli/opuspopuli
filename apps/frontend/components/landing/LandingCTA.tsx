"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";

export function LandingCTA() {
  const { t } = useTranslation("landing");
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-12 w-48 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mx-auto" />
    );
  }

  if (isAuthenticated) {
    return (
      <Link
        href="/region"
        className="inline-block px-8 py-3 bg-[#5A7A6A] text-white text-lg font-semibold rounded-lg hover:bg-[#4A6A5A] transition-colors"
      >
        {t("hero.ctaSignedIn")}
      </Link>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
      <Link
        href="/register"
        className="px-8 py-3 bg-[#5A7A6A] text-white text-lg font-semibold rounded-lg hover:bg-[#4A6A5A] transition-colors"
      >
        {t("hero.ctaSignedOut")}
      </Link>
      <Link
        href="/login"
        className="px-8 py-3 border border-[#222222] dark:border-white text-[#222222] dark:text-white text-lg font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        Sign in
      </Link>
    </div>
  );
}
