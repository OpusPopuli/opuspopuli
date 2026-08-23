"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { useOnboarding } from "@/lib/onboarding-context";
import { isOverlayHiddenRoute } from "@/lib/overlay-routes";

/**
 * Global floating scan button.
 *
 * A persistent camera FAB in the bottom-right of every authenticated screen, so
 * a citizen can scan a petition from anywhere in the app — it replaces the
 * "Petitions" link that used to live in the header nav.
 *
 * Hidden where it would be redundant or wrong:
 *  - signed-out users (scanning is a protected flow),
 *  - the auth screens (login/register/callback),
 *  - the petition area itself, which carries its own scan affordances (the
 *    camera is a full-screen black overlay; a floating button over the live
 *    viewfinder would be noise).
 *
 * The route list lives in lib/overlay-routes so every global overlay hides
 * on the same surfaces.
 */

export function ScanFab() {
  const { isAuthenticated } = useAuth();
  const { hasCompletedOnboarding } = useOnboarding();
  const pathname = usePathname();
  const { t } = useTranslation("common");

  if (!isAuthenticated) return null;
  // Not while the onboarding flow is running: the FAB's fixed position sits
  // over onboarding controls and would intercept their clicks.
  if (!hasCompletedOnboarding) return null;
  if (isOverlayHiddenRoute(pathname)) return null;

  const label = t("navigation.scanPetition");

  return (
    <Link
      href="/petition/capture"
      aria-label={label}
      title={label}
      className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg shadow-ink/20 transition-transform hover:bg-accent-strong hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      // Sit above the iOS home-indicator / Android nav bar rather than under it.
      style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
    >
      <svg
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
        />
      </svg>
    </Link>
  );
}
