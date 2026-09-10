"use client";

import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  MY_JURISDICTIONS,
  type MyJurisdictionsData,
} from "@/lib/graphql/region";
import {
  LayerPageShell,
  LayerSection,
} from "@/components/region/LayerPageShell";
import { LoadingSkeleton } from "@/components/region/ListStates";
import { findByType } from "@/lib/region-stack";

/**
 * The federal layer page (#1197).
 *
 * The shortest of the three, and it should look it — federal ingestion is
 * deliberately shallow because it is the level we can least affect. Thin
 * data reads as thin; the page says so rather than padding.
 */
export default function FederalLayerPage() {
  const { t } = useTranslation("region");
  const { data, loading } = useQuery<MyJurisdictionsData>(MY_JURISDICTIONS);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={2} height="h-20" />
      </div>
    );
  }

  const federal = findByType(
    data?.myJurisdictions ?? [],
    "CONGRESSIONAL_DISTRICT",
  );
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
      levelLabel={t("stack.levels.federal")}
      name={federal.jurisdiction.name}
      meta={t("stack.federal.subtitle")}
    >
      <LayerSection title={t("layer.recent")}>
        <p className="py-4 text-sm text-content-dim">
          {t("layer.federal.thin")}
        </p>
      </LayerSection>
    </LayerPageShell>
  );
}
