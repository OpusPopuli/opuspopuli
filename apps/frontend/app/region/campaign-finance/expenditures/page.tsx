"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import {
  GET_EXPENDITURES,
  ExpendituresData,
  Expenditure,
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

function ExpenditureCard({
  expenditure,
}: Readonly<{ expenditure: Expenditure }>) {
  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-[#222222]">
            {expenditure.payeeName}
          </h3>
          <p className="mt-1 text-sm text-[#555555]">
            {formatDate(expenditure.date)}
          </p>
          {expenditure.purposeDescription && (
            <p className="mt-2 text-sm text-[#555555] line-clamp-2">
              {expenditure.purposeDescription}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-lg font-semibold text-[#222222]">
            {formatCurrency(expenditure.amount)}
          </span>
          <SupportOpposeBadge value={expenditure.supportOrOppose} />
        </div>
      </div>
      <div className="mt-4 text-sm text-[#555555]">
        Source: {expenditure.sourceSystem}
      </div>
    </div>
  );
}

export default function ExpendituresPage() {
  const [page, setPage] = useState(0);
  const { data, loading, error } = useQuery<ExpendituresData>(
    GET_EXPENDITURES,
    {
      variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
    },
  );

  const renderContent = () => {
    if (loading) return <LoadingSkeleton />;
    if (error) return <ErrorState entity="expenditures" />;
    if (data?.expenditures.items.length === 0)
      return <EmptyState entity="expenditures" />;

    return (
      <>
        <div className="space-y-4">
          {data?.expenditures.items.map((expenditure) => (
            <ExpenditureCard key={expenditure.id} expenditure={expenditure} />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.expenditures.total || 0}
          hasMore={data?.expenditures.hasMore || false}
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
          { label: "Expenditures" },
        ]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">Expenditures</h1>
        <p className="mt-2 text-[#555555]">
          Campaign spending and payments for your region
        </p>
      </div>
      {renderContent()}
    </div>
  );
}
