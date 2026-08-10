"use client";

import { useMemo } from "react";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";

import {
  GET_REPRESENTATIVE_FUNDING,
  type RepresentativeFundingData,
  type IdVars,
} from "@/lib/graphql/region";
import { FinanceDisclaimer } from "@/components/region/FinanceDisclaimer";

type Formatter = (n: number) => string;

/**
 * The rep-page "money trail" (#943, epic #936). Aggregates the campaign finance
 * of the committees the linker (#941) attributed to this representative: totals,
 * top donors, and the top employers behind the money (the conflict-of-interest
 * lens). Empty-shaped until a rep has linked committees + a finance sync runs.
 */
export function RepresentativeFundingPanel({
  representativeId,
}: {
  readonly representativeId: string;
}) {
  const { t, i18n } = useTranslation("civics");
  // Currency is USD (US campaign finance) but grouping follows the active
  // locale so the ES surface reads naturally.
  const usd = useMemo<Intl.NumberFormat>(
    () =>
      new Intl.NumberFormat(i18n.language || "en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }),
    [i18n.language],
  );
  const { data, loading } = useQuery<RepresentativeFundingData, IdVars>(
    GET_REPRESENTATIVE_FUNDING,
    { variables: { id: representativeId }, fetchPolicy: "cache-and-network" },
  );

  const funding = data?.representativeFunding;

  if (loading && !funding) {
    return (
      <p className="text-sm text-content-dim italic">
        {t("repFinance.loading")}
      </p>
    );
  }

  if (!funding || funding.committeeCount === 0) {
    return (
      <p className="text-sm text-content-dim italic">{t("repFinance.empty")}</p>
    );
  }

  // CAL-ACCESS itemization reaches us thinly (~11 contributions per committee),
  // so these counts describe donors we could identify from the filings on hand,
  // not everyone who gave. The labels say so rather than overstating (#980).
  // Employer is frequently filed as a literal "N/A" placeholder — showing that
  // as a top employer reads as a finding when it is a blank field.
  const namedEmployers = funding.topEmployers.filter(
    (e) => e.employer && !/^(n\/?a|none|unknown)$/i.test(e.employer.trim()),
  );

  return (
    <section aria-label={t("repFinance.heading")} className="space-y-5">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label={t("repFinance.totalRaised")}
          value={usd.format(funding.totalRaised)}
        />
        <Stat
          label={t("repFinance.totalSpent")}
          value={usd.format(funding.totalSpent)}
        />
        <Stat
          label={t("repFinance.donors")}
          value={funding.donorCount.toLocaleString()}
        />
        <Stat
          label={t("repFinance.committees")}
          value={funding.committeeCount.toLocaleString()}
        />
      </dl>

      <p className="text-xs text-content-dim">
        {t("repFinance.itemizationNote")}
      </p>

      {funding.topDonors.length > 0 && (
        <MoneyList
          heading={t("repFinance.topDonors")}
          rows={funding.topDonors.map((d) => ({
            key: d.donorName,
            name: d.donorName,
            amount: d.totalAmount,
            count: d.contributionCount,
          }))}
          format={usd.format}
          countLabel={(n) => t("repFinance.contributions", { count: n })}
        />
      )}

      {namedEmployers.length > 0 && (
        <MoneyList
          heading={t("repFinance.topEmployers")}
          rows={namedEmployers.map((e) => ({
            key: e.employer,
            name: e.employer,
            amount: e.totalAmount,
            count: e.contributionCount,
          }))}
          format={usd.format}
          countLabel={(n) => t("repFinance.contributions", { count: n })}
        />
      )}

      {funding.committees.length > 0 && (
        <MoneyList
          heading={t("repFinance.throughCommittees")}
          rows={funding.committees.map((c) => ({
            key: c.id,
            name: c.name,
            amount: c.totalRaised,
          }))}
          format={usd.format}
        />
      )}

      <FinanceDisclaimer className="mt-1" />
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="bg-surface-alt rounded-lg p-3">
      <dt className="text-[11px] uppercase tracking-wide text-content-dim">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-bold text-content tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function MoneyList({
  heading,
  rows,
  format,
  countLabel,
}: {
  readonly heading: string;
  readonly rows: {
    key: string;
    name: string;
    amount: number;
    count?: number;
  }[];
  readonly format: Formatter;
  readonly countLabel?: (n: number) => string;
}) {
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-wider font-bold text-content-dim mb-2">
        {heading}
      </h4>
      <ol className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex items-baseline justify-between gap-3 text-sm border-l-2 border-line pl-3"
          >
            <span className="text-content truncate">{r.name}</span>
            <span className="flex-shrink-0 text-content-dim tabular-nums">
              <span className="font-semibold text-content">
                {format(r.amount)}
              </span>
              {countLabel && r.count != null && (
                <span className="text-[11px] text-content-dim">
                  {" "}
                  {countLabel(r.count)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
