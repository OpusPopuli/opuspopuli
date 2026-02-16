"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_EXPENDITURES,
  ExpendituresData,
  Expenditure,
} from "@/lib/graphql/region";

const PAGE_SIZE = 10;

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function SupportOpposeBadge({ value }: { readonly value: string | undefined }) {
  if (!value) return null;
  const isSupport = value === "support";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isSupport ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      }`}
    >
      {value}
    </span>
  );
}

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
            Failed to load expenditures. Please try again later.
          </p>
        </div>
      );
    }

    if (data?.expenditures.items.length === 0) {
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#555555]">No expenditures found.</p>
        </div>
      );
    }

    return (
      <>
        <div className="space-y-4">
          {data?.expenditures.items.map((expenditure) => (
            <ExpenditureCard key={expenditure.id} expenditure={expenditure} />
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <p className="text-sm text-[#555555]">
            Showing {page * PAGE_SIZE + 1} -{" "}
            {Math.min((page + 1) * PAGE_SIZE, data?.expenditures.total || 0)} of{" "}
            {data?.expenditures.total || 0}
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
              disabled={!data?.expenditures.hasMore}
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
        <span className="text-sm text-[#555555]">Expenditures</span>
      </nav>

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
