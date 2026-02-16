"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_COMMITTEES,
  CommitteesData,
  Committee,
} from "@/lib/graphql/region";

const PAGE_SIZE = 10;

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  pac: { bg: "bg-blue-100", text: "text-blue-800" },
  candidate: { bg: "bg-purple-100", text: "text-purple-800" },
  ballot_measure: { bg: "bg-green-100", text: "text-green-800" },
  super_pac: { bg: "bg-indigo-100", text: "text-indigo-800" },
  party: { bg: "bg-orange-100", text: "text-orange-800" },
  small_contributor: { bg: "bg-teal-100", text: "text-teal-800" },
  other: { bg: "bg-gray-100", text: "text-gray-800" },
};

function TypeBadge({ type }: { readonly type: string }) {
  const style = TYPE_STYLES[type] || TYPE_STYLES.other;
  const label = type.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { readonly status: string }) {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
      }`}
    >
      {status}
    </span>
  );
}

function CommitteeCard({ committee }: Readonly<{ committee: Committee }>) {
  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-[#222222] line-clamp-2">
            {committee.name}
          </h3>
          {committee.candidateName && (
            <p className="mt-1 text-sm text-[#555555]">
              Candidate: {committee.candidateName}
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <TypeBadge type={committee.type} />
          <StatusBadge status={committee.status} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-[#555555]">
        <span>Source: {committee.sourceSystem}</span>
        {committee.sourceUrl && (
          <a
            href={committee.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-700 hover:underline"
          >
            Source
          </a>
        )}
      </div>
    </div>
  );
}

export default function CommitteesPage() {
  const [page, setPage] = useState(0);
  const { data, loading, error } = useQuery<CommitteesData>(GET_COMMITTEES, {
    variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
  });

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
            Failed to load committees. Please try again later.
          </p>
        </div>
      );
    }

    if (data?.committees.items.length === 0) {
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#555555]">No committees found.</p>
        </div>
      );
    }

    return (
      <>
        <div className="space-y-4">
          {data?.committees.items.map((committee) => (
            <CommitteeCard key={committee.id} committee={committee} />
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <p className="text-sm text-[#555555]">
            Showing {page * PAGE_SIZE + 1} -{" "}
            {Math.min((page + 1) * PAGE_SIZE, data?.committees.total || 0)} of{" "}
            {data?.committees.total || 0}
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
              disabled={!data?.committees.hasMore}
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
      <nav className="mb-6">
        <Link
          href="/region"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Region
        </Link>
        <span className="mx-2 text-[#555555]">/</span>
        <Link
          href="/region/campaign-finance"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Campaign Finance
        </Link>
        <span className="mx-2 text-[#555555]">/</span>
        <span className="text-sm text-[#555555]">Committees</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">Committees</h1>
        <p className="mt-2 text-[#555555]">
          Campaign committees and PACs for your region
        </p>
      </div>

      {renderContent()}
    </div>
  );
}
