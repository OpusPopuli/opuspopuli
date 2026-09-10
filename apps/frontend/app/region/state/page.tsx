"use client";

import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_BILLS,
  GET_PROPOSITIONS,
  MY_JURISDICTIONS,
  type BillsData,
  type PropositionsData,
  type MyJurisdictionsData,
} from "@/lib/graphql/region";
import { STATEWIDE_INITIATIVE } from "@/lib/graphql/counties";
import {
  ActivityRow,
  IndexRow,
  LayerPageShell,
  LayerSection,
} from "@/components/region/LayerPageShell";
import { LoadingSkeleton } from "@/components/region/ListStates";
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

  const { data: jur, loading } =
    useQuery<MyJurisdictionsData>(MY_JURISDICTIONS);
  const { data: billData } = useQuery<BillsData>(GET_BILLS, {
    variables: { take: RECENT_LIMIT },
  });
  const { data: propData } = useQuery<PropositionsData>(GET_PROPOSITIONS, {
    variables: { take: RECENT_LIMIT },
  });

  const legislators = useStateLegislators(jur?.myJurisdictions ?? []);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={3} height="h-20" />
      </div>
    );
  }

  const jurisdictions = jur?.myJurisdictions ?? [];
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
      levelLabel={t("stack.levels.state")}
      name={state.name}
      meta={t("layer.state.legislature")}
      header={
        <div className="mt-6 space-y-4">
          {seats.length > 0 && (
            <div className="rounded-md bg-surface-sunk px-4 py-3 text-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-content-dim">
                {t("layer.state.yourSeats")}
              </span>
              <ul className="mt-1 space-y-0.5">
                {seats.map((seat) => (
                  <li key={seat.id}>
                    <Link
                      href={`/region/representatives/${seat.id}`}
                      prefetch={false}
                      className="font-semibold text-content underline decoration-line underline-offset-2 hover:decoration-accent"
                    >
                      {seat.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The county figure links to a stored source_url because it comes
              from county_thresholds. These two are fixed percentages set by
              statute, not an ingested dataset, so they cite the statute
              instead — and no deep link, which the SOS reorganises between
              cycles (#1105). */}
          <div className="border-l-[3px] border-line bg-surface-sunk px-4 py-3">
            <p className="font-serif text-2xl tabular-nums text-content">
              {nf.format(STATEWIDE_INITIATIVE.statute)}
            </p>
            <p className="mt-1 text-sm text-content-dim">
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
      <LayerSection title={t("layer.recent")}>
        {bills.length === 0 ? (
          <p className="py-4 text-sm text-content-dim">
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
      </LayerSection>

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
