"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_REPRESENTATIVES,
  RepresentativesData,
  Representative,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";

const PAGE_SIZE = 12;

const PARTY_COLORS: Record<string, { bg: string; text: string }> = {
  Democrat: { bg: "bg-blue-100", text: "text-blue-800" },
  Republican: { bg: "bg-red-100", text: "text-red-800" },
  Independent: { bg: "bg-purple-100", text: "text-purple-800" },
  Green: { bg: "bg-green-100", text: "text-green-800" },
  Libertarian: { bg: "bg-yellow-100", text: "text-yellow-800" },
};

function PartyBadge({ party }: { readonly party: string }) {
  const colors = PARTY_COLORS[party] || {
    bg: "bg-gray-100",
    text: "text-gray-800",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
    >
      {party}
    </span>
  );
}

function RepresentativeCard({
  representative,
}: Readonly<{ representative: Representative }>) {
  return (
    <Link
      href={`/region/representatives/${representative.id}`}
      className="block bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow"
    >
      <div className="flex items-start gap-4">
        {/* Photo */}
        <div className="flex-shrink-0">
          {representative.photoUrl ? (
            <Image
              src={representative.photoUrl}
              alt={representative.name}
              width={64}
              height={64}
              className="w-16 h-16 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-[#222222]">
            {representative.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <PartyBadge party={representative.party} />
            <span className="text-sm text-[#4d4d4d]">
              {representative.chamber}
            </span>
          </div>
          <p className="mt-1 text-sm text-[#4d4d4d]">
            District {representative.district}
          </p>
        </div>

        {/* Arrow indicator */}
        <svg
          className="w-5 h-5 text-gray-400 flex-shrink-0 mt-1"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </div>
    </Link>
  );
}

export default function RepresentativesPage() {
  const [page, setPage] = useState(0);
  const [chamber, setChamber] = useState<string | undefined>(undefined);

  const { data, loading, error } = useQuery<RepresentativesData>(
    GET_REPRESENTATIVES,
    {
      variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE, chamber },
    },
  );

  // Fetch all reps (unfiltered) to build complete chamber list
  const { data: allData } = useQuery<RepresentativesData>(GET_REPRESENTATIVES, {
    variables: { skip: 0, take: 200 },
  });

  const chambers = allData?.representatives.items
    ? Array.from(
        new Set(allData.representatives.items.map((r) => r.chamber)),
      ).sort()
    : [];

  const renderContent = () => {
    if (loading) return <LoadingSkeleton count={4} height="h-40" grid />;
    if (error) return <ErrorState entity="representatives" />;
    if (data?.representatives.items.length === 0)
      return <EmptyState entity="representatives" />;

    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.representatives.items.map((rep) => (
            <RepresentativeCard key={rep.id} representative={rep} />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.representatives.total || 0}
          hasMore={data?.representatives.hasMore || false}
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
          { label: "Representatives" },
        ]}
      />

      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#222222]">Representatives</h1>
          <p className="mt-2 text-[#4d4d4d]">
            Elected officials and legislators
          </p>
        </div>

        {/* Chamber Filter */}
        {chambers.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="chamber"
              className="text-sm font-medium text-[#4d4d4d]"
            >
              Filter:
            </label>
            <select
              id="chamber"
              value={chamber || ""}
              onChange={(e) => {
                setChamber(e.target.value || undefined);
                setPage(0);
              }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none"
            >
              <option value="">All Chambers</option>
              {chambers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
}
