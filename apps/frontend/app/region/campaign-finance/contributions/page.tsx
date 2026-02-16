"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import {
  GET_CONTRIBUTIONS,
  ContributionsData,
  Contribution,
} from "@/lib/graphql/region";
import { formatCurrency, formatDate } from "@/lib/format";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";

const PAGE_SIZE = 10;

function DonorTypeBadge({ type }: { readonly type: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    individual: { bg: "bg-blue-100", text: "text-blue-800" },
    committee: { bg: "bg-purple-100", text: "text-purple-800" },
    party: { bg: "bg-orange-100", text: "text-orange-800" },
    other: { bg: "bg-gray-100", text: "text-gray-800" },
  };
  const style = styles[type] || styles.other;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
    >
      {type}
    </span>
  );
}

function ContributionCard({
  contribution,
}: Readonly<{ contribution: Contribution }>) {
  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-[#222222]">
            {contribution.donorName}
          </h3>
          <p className="mt-1 text-sm text-[#555555]">
            {formatDate(contribution.date)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-lg font-semibold text-[#222222]">
            {formatCurrency(contribution.amount)}
          </span>
          <DonorTypeBadge type={contribution.donorType} />
        </div>
      </div>
      <div className="mt-4 text-sm text-[#555555]">
        Source: {contribution.sourceSystem}
      </div>
    </div>
  );
}

export default function ContributionsPage() {
  const [page, setPage] = useState(0);
  const { data, loading, error } = useQuery<ContributionsData>(
    GET_CONTRIBUTIONS,
    {
      variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
    },
  );

  const renderContent = () => {
    if (loading) return <LoadingSkeleton />;
    if (error) return <ErrorState entity="contributions" />;
    if (data?.contributions.items.length === 0)
      return <EmptyState entity="contributions" />;

    return (
      <>
        <div className="space-y-4">
          {data?.contributions.items.map((contribution) => (
            <ContributionCard
              key={contribution.id}
              contribution={contribution}
            />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.contributions.total || 0}
          hasMore={data?.contributions.hasMore || false}
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
          { label: "Contributions" },
        ]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">Contributions</h1>
        <p className="mt-2 text-[#555555]">
          Campaign donations and contributions for your region
        </p>
      </div>
      {renderContent()}
    </div>
  );
}
