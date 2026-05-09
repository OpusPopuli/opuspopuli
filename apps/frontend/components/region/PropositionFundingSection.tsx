"use client";

import { useQuery } from "@apollo/client/react";
import {
  GET_PROPOSITION_FUNDING,
  type PropositionFundingData,
  type PropositionIdVars,
  type SidedFunding,
} from "@/lib/graphql/region";
import { formatCurrency, formatDate } from "@/lib/format";
import { SectionTitle } from "@/components/region/SectionTitle";

/**
 * "Who's Funding This" section for the proposition detail page (Layer 2).
 *
 * Two-column Yes/No layout (`grid-cols-1 sm:grid-cols-2`) using the neutral
 * slate palette so neither side reads as "good" or "bad" — same convention
 * as YesNoOutcomeCard. Each column shows totals, donor/committee counts,
 * top donors, and primary committees with links to their detail pages.
 *
 * Always renders (no `hasAnalysis` gating). When the analyzer has no
 * positions for this measure, both sides show the empty state — clearer
 * than hiding the section, since "no funding yet" is itself information
 * for a voter looking at an early-cycle measure.
 */
export function PropositionFundingSection({
  propositionId,
}: {
  readonly propositionId: string;
}) {
  const { data, loading, error } = useQuery<
    PropositionFundingData,
    PropositionIdVars
  >(GET_PROPOSITION_FUNDING, {
    variables: { propositionId },
    fetchPolicy: "cache-and-network",
  });

  if (loading && !data) {
    return (
      <section className="mb-8">
        <SectionTitle>Who&apos;s Funding This</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FundingSkeleton label="Supporting" />
          <FundingSkeleton label="Opposing" />
        </div>
      </section>
    );
  }

  if (error || !data?.propositionFunding) {
    return (
      <section className="mb-8">
        <SectionTitle>Who&apos;s Funding This</SectionTitle>
        <FundingEmpty />
      </section>
    );
  }

  const funding = data.propositionFunding;
  const hasAnyMoney =
    funding.support.totalRaised > 0 ||
    funding.oppose.totalRaised > 0 ||
    funding.support.totalSpent > 0 ||
    funding.oppose.totalSpent > 0;

  if (!hasAnyMoney) {
    return (
      <section className="mb-8">
        <SectionTitle>Who&apos;s Funding This</SectionTitle>
        <FundingEmpty />
      </section>
    );
  }

  return (
    <section className="mb-8">
      <SectionTitle>Who&apos;s Funding This</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <FundingSideCard label="Supporting" side={funding.support} />
        <FundingSideCard label="Opposing" side={funding.oppose} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Reflects CalAccess records as of {formatDate(funding.asOf)}.
      </p>
    </section>
  );
}

/**
 * One column of the funding grid. Renders totals + donor/committee counts
 * up top, then top donors, then primary committees as links.
 */
function FundingSideCard({
  label,
  side,
}: {
  readonly label: string;
  readonly side: SidedFunding;
}) {
  return (
    <div className="border-2 border-gray-200 rounded-xl p-5">
      <p className="text-xs uppercase tracking-[1.5px] font-extrabold text-[#595959] mb-3">
        {label}
      </p>

      <p className="text-2xl font-extrabold text-[#222222]">
        {formatCurrency(side.totalRaised)}
      </p>
      <p className="text-xs text-slate-600 mb-4">
        raised by {pluralize(side.committeeCount, "committee")} from{" "}
        {pluralize(side.donorCount, "donor")}
      </p>

      {side.topDonors.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
            Top donors
          </p>
          <ul className="space-y-1.5">
            {side.topDonors.map((donor) => (
              <li
                key={donor.donorName}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="text-[#334155] truncate">
                  {donor.donorName}
                </span>
                <span className="text-[#222222] font-semibold whitespace-nowrap">
                  {formatCurrency(donor.totalAmount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {side.primaryCommittees.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
            Primary committees
          </p>
          <ul className="space-y-1.5">
            {side.primaryCommittees.map((committee) => (
              <li key={committee.id} className="text-sm text-[#334155]">
                {committee.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FundingSkeleton({ label }: { readonly label: string }) {
  return (
    <div className="border-2 border-gray-200 rounded-xl p-5 animate-pulse">
      <p className="text-xs uppercase tracking-[1.5px] font-extrabold text-[#595959] mb-3">
        {label}
      </p>
      <div className="h-7 w-32 bg-slate-200 rounded mb-2" />
      <div className="h-3 w-40 bg-slate-100 rounded mb-5" />
      <div className="space-y-2">
        <div className="h-3 bg-slate-100 rounded w-full" />
        <div className="h-3 bg-slate-100 rounded w-5/6" />
        <div className="h-3 bg-slate-100 rounded w-4/6" />
      </div>
    </div>
  );
}

function FundingEmpty() {
  return (
    <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center">
      <p className="text-sm text-slate-700">
        No campaign-finance filings linked to this measure yet.
      </p>
      <p className="text-xs text-slate-500 mt-1">
        Funding data appears once committees file Form 410 declarations or
        report expenditures targeting this measure.
      </p>
    </div>
  );
}

function pluralize(n: number, singular: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${singular}s`;
}
