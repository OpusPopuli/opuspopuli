"use client";

import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useInstallPrompt } from "@/lib/hooks/useInstallPrompt";
import { IosInstallSteps } from "./IosInstallSteps";

/**
 * "Install app" control for a menu or settings surface.
 *
 * Renders nothing when the app is already installed or the browser has not
 * offered an install path — an install button that does nothing when tapped
 * is worse than no button.
 *
 * Unlike the banner this ignores dismissal: the user went looking for it.
 */
export function InstallAppButton({
  className,
}: Readonly<{ className?: string }>) {
  const { t } = useTranslation("common");
  const { isInstallable, method, install } = useInstallPrompt();
  const [stepsOpen, setStepsOpen] = useState(false);
  const stepsId = useId();

  const onClick = useCallback(() => {
    if (method === "native") {
      void install();
      return;
    }
    setStepsOpen((open) => !open);
  }, [install, method]);

  if (!isInstallable) return null;

  const isIos = method === "ios-share";

  return (
    <div className={className}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        aria-expanded={isIos ? stepsOpen : undefined}
        aria-controls={isIos ? stepsId : undefined}
        className="w-full justify-start"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M12 3v12m0 0l-4-4m4 4l4-4M4.5 16.5v1.75A2.25 2.25 0 006.75 20.5h10.5a2.25 2.25 0 002.25-2.25V16.5"
          />
        </svg>
        {t("install.action")}
      </Button>
      {isIos && stepsOpen && <IosInstallSteps id={stepsId} className="mt-2" />}
    </div>
  );
}
