"use client";

import { useTranslation } from "react-i18next";

interface IosInstallStepsProps {
  readonly id?: string;
  readonly className?: string;
}

/**
 * The Share → Add to Home Screen recipe for iOS/iPadOS, where there is no
 * programmatic install API. Shared by the passive banner and the menu button
 * so the wording only exists once.
 */
export function IosInstallSteps({
  id,
  className,
}: Readonly<IosInstallStepsProps>) {
  const { t } = useTranslation("common");

  return (
    <ol
      id={id}
      className={`list-decimal space-y-1 pl-5 text-sm text-content-dim ${className ?? ""}`}
    >
      <li>{t("install.iosSteps.share")}</li>
      <li>{t("install.iosSteps.add")}</li>
      <li>{t("install.iosSteps.confirm")}</li>
    </ol>
  );
}
