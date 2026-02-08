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
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow">
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

      <div className="mt-4 flex items-center justify-between text-sm">
        <div className="text-[#555555]">
          {electionDate && <span>Election: {electionDate}</span>}
        </div>
        <div className="flex items-center gap-3">
          {proposition.sourceUrl && (
            <a
              href={proposition.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              Source
            </a>
          )}
        </div>
      </div>
    </div>
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
    if (loading) {
      return (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-gray-200 rounded-xl h-32"></div>
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600">
            Failed to load propositions. Please try again later.
          </p>
        </div>
      );
    }

    if (data?.propositions.items.length === 0) {
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#555555]">No propositions found.</p>
        </div>
      );
    }

    return (
      <>
        <div className="space-y-4">
          {data?.propositions.items.map((prop) => (
            <PropositionCard key={prop.id} proposition={prop} />
          ))}
        </div>

        {/* Pagination */}
        <div className="mt-8 flex items-center justify-between">
          <p className="text-sm text-[#555555]">
            Showing {page * PAGE_SIZE + 1} -{" "}
            {Math.min((page + 1) * PAGE_SIZE, data?.propositions.total || 0)} of{" "}
            {data?.propositions.total || 0}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 text-sm font-medium text-[#222222] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.propositions.hasMore}
              className="px-4 py-2 text-sm font-medium text-[#222222] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      {/* Breadcrumb */}
      <nav className="mb-6">
        <Link
          href="/region"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Region
        </Link>
        <span className="mx-2 text-[#555555]">/</span>
        <span className="text-sm text-[#555555]">Propositions</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">Propositions</h1>
        <p className="mt-2 text-[#555555]">
          Ballot measures and initiatives for your region
        </p>
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
}
