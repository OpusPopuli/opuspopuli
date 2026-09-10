"use client";

import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_BILLS,
  GET_PROPOSITIONS,
  type BillsData,
  type PropositionsData,
} from "@/lib/graphql/region";
import { STATEWIDE_INITIATIVE } from "@/lib/graphql/counties";
import {
  ActivityRow,
  DetailRow,
  IndexRow,
  LayerPageShell,
  LayerSection,
  Ledger,
} from "@/components/region/LayerPageShell";
import { LoadingSkeleton } from "@/components/region/ListStates";
import { useJurisdictions } from "@/components/region/JurisdictionsContext";
import { findState } from "@/lib/region-stack";
import { useStateLegislators } from "@/lib/hooks/useStateLegislators";
import { formatDate } from "@/lib/format";

const RECENT_LIMIT = 5;

/**
 * The state layer page (#1196).
 *
 * This is where the five cards from the old /region live now — demoted from
 * "the whole page" to one level's index, and carrying the counts they never
 * had. Nothing was removed and no route moved; the page above simply stopped
 * pretending California is the container the reader lives in.
 */
export default function StateLayerPage() {
  const { t, i18n } = useTranslation("region");

  const { jurisdictions, loading } = useJurisdictions();
  const { data: billData } = useQuery<BillsData>(GET_BILLS, {
    variables: { take: RECENT_LIMIT },
  });
  const { data: propData } = useQuery<PropositionsData>(GET_PROPOSITIONS, {
    variables: { take: RECENT_LIMIT },
  });

  const legislators = useStateLegislators(jurisdictions);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={3} height="h-20" />
      </div>
    );
  }

  const state = findState(jurisdictions);
  if (!state) {
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

  const bills = billData?.bills.items ?? [];
  const nf = new Intl.NumberFormat(i18n.language);

  // Chamber comes off the roster row rather than the district we asked for,
  // so a representative is never labelled with a chamber we assumed.
  const seats = legislators.map((rep) => ({
    id: rep.id,
    label: t("layer.state.seatValue", {
      chamber: rep.chamber,
      district: rep.district,
      name: rep.name,
    }),
  }));
  const billTotal = billData?.bills.total;
  const propTotal = propData?.propositions.total;

  return (
    <LayerPageShell
      level="STATE"
      levelLabel={t("stack.levels.state")}
      name={state.name}
      meta={t("layer.state.legislature")}
      header={
        <div className="mt-8">
          <div className="border-l-[3px] border-line bg-surface-sunk px-6 py-5">
            <p className="font-serif text-5xl leading-none tabular-nums text-content">
              {nf.format(STATEWIDE_INITIATIVE.statute)}
            </p>
            <p className="mt-3 font-semibold text-content">
              {t("layer.state.thresholdLead")}
            </p>
            <p className="mt-0.5 text-sm text-content-dim">
              {t("layer.state.threshold", {
                amendment: nf.format(
                  STATEWIDE_INITIATIVE.constitutionalAmendment,
                ),
              })}
            </p>
          </div>
        </div>
      }
    >
      {seats.length > 0 && (
        <LayerSection title={t("layer.state.yourSeats")}>
          {seats.map((seat) => (
            <DetailRow
              key={seat.id}
              strong
              label={
                <Link
                  href={`/region/representatives/${seat.id}`}
                  prefetch={false}
                  className="underline decoration-line underline-offset-4 hover:decoration-accent"
                >
                  {seat.label}
                </Link>
              }
              detail={t("layer.county.resolvedFromPlain")}
            />
          ))}
        </LayerSection>
      )}

      <Ledger when={t("layer.when")} what={t("layer.state.whatDid")}>
        {bills.length === 0 ? (
          <p className="py-5 text-sm text-content-dim">
            {t("layer.state.noBills")}
          </p>
        ) : (
          bills.map((b) => (
            <ActivityRow
              key={b.id}
              badge={b.billNumber}
              what={b.title}
              sub={b.lastAction}
              when={b.lastActionDate ? formatDate(b.lastActionDate) : null}
              href={`/region/bills/${b.id}`}
            />
          ))
        )}
      </Ledger>

      {/* The five destinations from the old /region — every one still
          reachable, now with a number on the door. */}
      <LayerSection title={t("layer.browse")}>
        <IndexRow
          label={t("layer.state.bills")}
          href="/region/bills"
          count={billTotal === undefined ? null : nf.format(billTotal)}
        />
        <IndexRow
          label={t("layer.state.propositions")}
          href="/region/propositions"
          count={propTotal === undefined ? null : nf.format(propTotal)}
        />
        <IndexRow
          label={t("layer.state.committees")}
          href="/region/legislative-committees"
          count={t("layer.seeAll")}
        />
        <IndexRow
          label={t("layer.state.finance")}
          href="/region/campaign-finance"
          count={t("layer.seeAll")}
        />
        <IndexRow
          label={t("layer.state.representatives")}
          href="/region/representatives"
          count={t("layer.seeAll")}
        />
      </LayerSection>
    </LayerPageShell>
  );
}
