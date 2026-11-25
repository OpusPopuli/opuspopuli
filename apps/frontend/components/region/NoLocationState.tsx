"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/ui/cn";
import { useJurisdictions } from "./JurisdictionsContext";
import { LocateForm } from "./LocateForm";

/**
 * What a region page shows when it doesn't know where the reader lives.
 *
 * A visitor without an account (#1456) can fix that here and now, so they
 * get the lookup. A signed-in reader's location is their saved address, so
 * they're pointed at settings, as before.
 */
export function NoLocationState({
  framed = false,
}: {
  /** The region home draws this as a card; the layer pages don't. */
  readonly framed?: boolean;
}) {
  const { t } = useTranslation("region");
  const { source } = useJurisdictions();

  if (source === "device") return <LocateForm />;

  return (
    <div
      className={cn(framed && "rounded-lg border border-line bg-surface p-6")}
    >
      <p className="font-semibold text-content">{t("stack.noAddress.title")}</p>
      <p className="mt-1 text-sm text-content-dim">
        {t("stack.noAddress.body")}
      </p>
    </div>
  );
}
