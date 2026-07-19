"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { buttonVariants } from "@/components/ui/Button";

export function LandingCTA() {
  const { t } = useTranslation("landing");
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-12 w-48 bg-surface-sunk rounded-lg animate-pulse mx-auto" />
    );
  }

  if (isAuthenticated) {
    return (
      <Link
        href="/me/briefing"
        className={buttonVariants({ variant: "gold", size: "lg" })}
      >
        {t("hero.ctaSignedIn")}
      </Link>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
      <Link
        href="/register"
        className={buttonVariants({ variant: "gold", size: "lg" })}
      >
        {t("hero.ctaSignedOut")}
      </Link>
      <Link
        href="/login"
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        {t("hero.ctaSignIn")}
      </Link>
    </div>
  );
}
