"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import {
  GET_INDEPENDENT_EXPENDITURES,
  IndependentExpendituresData,
  IndependentExpenditure,
} from "@/lib/graphql/region";
import { formatCurrency, formatDate } from "@/lib/format";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import { SupportOpposeBadge } from "@/components/region/SupportOpposeBadge";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";

const PAGE_SIZE = 10;

function IndependentExpenditureCard({
  ie,
}: Readonly<{ ie: IndependentExpenditure }>) {
  const target = ie.candidateName || ie.propositionTitle;

  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-[#222222]">
            {ie.committeeName}
          </h3>
          {target && (
            <p className="mt-1 text-sm text-[#555555]">
              {ie.candidateName ? "Candidate" : "Proposition"}: {target}
            </p>
          )}
          <p className="mt-1 text-sm text-[#555555]">{formatDate(ie.date)}</p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-lg font-semibold text-[#222222]">
            {formatCurrency(ie.amount)}
          </span>
          <SupportOpposeBadge value={ie.supportOrOppose} />
        </div>
      </div>
      <div className="mt-4 text-sm text-[#555555]">
        Source: {ie.sourceSystem}
      </div>
    </div>
  );
}

export default function IndependentExpendituresPage() {
  const [page, setPage] = useState(0);
  const { data, loading, error } = useQuery<IndependentExpendituresData>(
    GET_INDEPENDENT_EXPENDITURES,
    {
      variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
    },
  );

  const renderContent = () => {
    if (loading) return <LoadingSkeleton />;
    if (error) return <ErrorState entity="independent expenditures" />;
    if (data?.independentExpenditures.items.length === 0)
      return <EmptyState entity="independent expenditures" />;

    return (
      <>
        <div className="space-y-4">
          {data?.independentExpenditures.items.map((ie) => (
            <IndependentExpenditureCard key={ie.id} ie={ie} />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.independentExpenditures.total || 0}
          hasMore={data?.independentExpenditures.hasMore || false}
          onPageChange={setPage}
        />
      </>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <Breadcrumb
        segments={[
          { label: "Region", href: "/region" },
          { label: "Campaign Finance", href: "/region/campaign-finance" },
          { label: "Independent Expenditures" },
        ]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">
          Independent Expenditures
        </h1>
        <p className="mt-2 text-[#555555]">
          Independent spending for/against candidates and measures
        </p>
      </div>
      {renderContent()}
    </div>
  );
}
