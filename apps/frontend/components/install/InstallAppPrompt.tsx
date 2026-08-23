"use client";

import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useInstallPrompt } from "@/lib/hooks/useInstallPrompt";
import { isOverlayHiddenRoute } from "@/lib/overlay-routes";
import { IosInstallSteps } from "./IosInstallSteps";

/**
 * Passive "add OPUS to your home screen" banner.
 *
 * Appears once the browser reports the app is installable (Chromium) or the
 * visitor is on iOS, where installing is a Share-sheet gesture we can only
 * describe. Dismissal is remembered for 30 days — see `useInstallPrompt`.
 *
 * Sits above the scan FAB and the offline indicator, and clears the iOS home
 * indicator via the safe-area inset.
 */
export function InstallAppPrompt() {
  const { t } = useTranslation("common");
  const pathname = usePathname();
  const { isInstallable, isDismissed, method, install, dismiss } =
    useInstallPrompt();

  // Same surfaces the scan FAB hides on: the fullscreen camera and the
  // auth flows. A banner floating over the live viewfinder is a bug.
  if (isOverlayHiddenRoute(pathname)) return null;
  if (!isInstallable || isDismissed) return null;

  return (
    <aside
      aria-label={t("install.title")}
      className="fixed inset-x-4 z-40 rounded-xl border border-line bg-surface p-4 shadow-lg shadow-ink/10 sm:left-auto sm:right-5 sm:w-80"
      style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-start gap-3">
        <p className="flex-1 font-medium text-content">{t("install.title")}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("install.dismissLabel")}
          className="-m-1 rounded p-1 text-content-dim transition-colors hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
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
              strokeWidth={1.75}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <p className="mt-1 text-sm text-content-dim">
        {t("install.description")}
      </p>

      {method === "ios-share" ? (
        <IosInstallSteps className="mt-3" />
      ) : (
        <div className="mt-3 flex gap-2">
          <Button variant="gold" size="sm" onClick={() => void install()}>
            {t("install.action")}
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            {t("install.notNow")}
          </Button>
        </div>
      )}
    </aside>
  );
}
