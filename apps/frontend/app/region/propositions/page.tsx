"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_PROPOSITIONS,
  PropositionsData,
  Proposition,
  PropositionStatus,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";

const PAGE_SIZE = 10;

const STATUS_STYLES: Record<
  PropositionStatus,
  { bg: string; text: string; label: string }
> = {
  PENDING: {
    bg: "bg-yellow-100",
    text: "text-yellow-800",
    label: "Pending",
  },
  PASSED: {
    bg: "bg-green-100",
    text: "text-green-800",
    label: "Passed",
  },
  FAILED: {
    bg: "bg-red-100",
    text: "text-red-800",
    label: "Failed",
  },
  WITHDRAWN: {
    bg: "bg-gray-100",
    text: "text-gray-800",
    label: "Withdrawn",
  },
};

function StatusBadge({ status }: { readonly status: PropositionStatus }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

function PropositionCard({
  proposition,
}: Readonly<{ proposition: Proposition }>) {
  const electionDate = proposition.electionDate
    ? new Date(proposition.electionDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <Link
      href={`/region/propositions/${proposition.id}`}
      className="block bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-[#222222] line-clamp-2">
            {proposition.title}
          </h3>
          <p className="mt-2 text-sm text-[#555555] line-clamp-3">
            {proposition.summary}
          </p>
        </div>
        <StatusBadge status={proposition.status} />
      </div>

      {electionDate && (
        <div className="mt-4 text-sm text-[#555555]">
          Election: {electionDate}
        </div>
      )}
    </Link>
  );
}

export default function PropositionsPage() {
  const [page, setPage] = useState(0);
  const { data, loading, error } = useQuery<PropositionsData>(
    GET_PROPOSITIONS,
    {
      variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
    },
  );

  const renderContent = () => {
    if (loading) return <LoadingSkeleton />;
    if (error) return <ErrorState entity="propositions" />;
    if (data?.propositions.items.length === 0)
      return <EmptyState entity="propositions" />;

    return (
      <>
        <div className="space-y-4">
          {data?.propositions.items.map((prop) => (
            <PropositionCard key={prop.id} proposition={prop} />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.propositions.total || 0}
          hasMore={data?.propositions.hasMore || false}
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
          { label: "Propositions" },
        ]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">Propositions</h1>
        <p className="mt-2 text-[#555555]">
          Ballot measures and initiatives for your region
        </p>
      </div>
      {renderContent()}
    </div>
  );
}
