"use client";

import { useTranslation } from "react-i18next";
import {
  BuildingTag,
  LayerPageShell,
  LayerSection,
} from "@/components/region/LayerPageShell";
import { LoadingSkeleton } from "@/components/region/ListStates";
import { findByType } from "@/lib/region-stack";
import { useJurisdictions } from "@/components/region/JurisdictionsContext";

/**
 * The federal layer page (#1197).
 *
 * The shortest of the three, and it should look it — federal ingestion is
 * deliberately shallow because it is the level we can least affect. Thin
 * data reads as thin; the page says so rather than padding.
 */
export default function FederalLayerPage() {
  const { t } = useTranslation("region");
  const { jurisdictions, loading } = useJurisdictions();

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={2} height="h-20" />
      </div>
    );
  }

  const federal = findByType(jurisdictions, "CONGRESSIONAL_DISTRICT");
  if (!federal) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <p className="font-semibold text-content">
          {t("stack.noAddress.title")}
        </p>
        <p className="mt-1 text-sm text-content-dim">
          {t("stack.noAddress.body")}
        </p>
      </div>
    );
  }

  return (
    <LayerPageShell
      level="FEDERAL"
      levelLabel={t("stack.levels.federal")}
      name={t("layer.federal.title")}
      meta={t("layer.federal.meta", {
        district: federal.jurisdiction.name,
      })}
    >
      <LayerSection title={t("layer.federal.yourSeats")}>
        <p className="flex flex-wrap items-center gap-3 py-5 text-sm leading-relaxed text-content-dim">
          <BuildingTag label={t("layer.building")} />
          {t("layer.federal.seatsPending", {
            district: federal.jurisdiction.name,
          })}
        </p>
      </LayerSection>

      <LayerSection title={t("layer.federal.ledger")}>
        <p className="py-5 text-sm leading-relaxed text-content-dim">
          {t("layer.federal.thin")}
        </p>
      </LayerSection>
    </LayerPageShell>
  );
}
