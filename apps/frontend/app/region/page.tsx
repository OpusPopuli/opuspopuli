"use client";

import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_REGION_INFO,
  RegionInfoData,
  DataType,
} from "@/lib/graphql/region";

const DATA_TYPE_CARDS: Record<
  DataType,
  { title: string; description: string; href: string; icon: string }
> = {
  PROPOSITIONS: {
    title: "Propositions",
    description: "Ballot measures and initiatives",
    href: "/region/propositions",
    icon: "ballot",
  },
  MEETINGS: {
    title: "Meetings",
    description: "Legislative sessions and hearings",
    href: "/region/meetings",
    icon: "calendar",
  },
  REPRESENTATIVES: {
    title: "Representatives",
    description: "Elected officials and legislators",
    href: "/region/representatives",
    icon: "users",
  },
};

function DataTypeIcon({ type }: { readonly type: string }) {
  switch (type) {
    case "ballot":
      return (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      );
    case "users":
      return (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      );
    default:
      return null;
  }
}

export default function RegionPage() {
  const { data, loading, error } = useQuery<RegionInfoData>(GET_REGION_INFO);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <div className="animate-pulse space-y-8">
          <div className="space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600">
            Failed to load region information. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const regionInfo = data?.regionInfo;

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      {/* Region Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-[#222222]">
          {regionInfo?.name || "Region"}
        </h1>
        <p className="mt-2 text-[#555555]">
          {regionInfo?.description || "Explore civic data for your region"}
        </p>
        {regionInfo?.timezone && (
          <p className="mt-1 text-sm text-[#555555]">
            Timezone: {regionInfo.timezone}
          </p>
        )}
      </div>

      {/* Data Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {regionInfo?.supportedDataTypes.map((dataType) => {
          const card = DATA_TYPE_CARDS[dataType];
          if (!card) return null;

          return (
            <Link
              key={dataType}
              href={card.href}
              className="group bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-all duration-200"
            >
              <div className="text-[#555555] group-hover:text-[#222222] transition-colors mb-4">
                <DataTypeIcon type={card.icon} />
              </div>
              <h2 className="text-lg font-semibold text-[#222222] group-hover:text-blue-600 transition-colors">
                {card.title}
              </h2>
              <p className="mt-1 text-sm text-[#555555]">{card.description}</p>
            </Link>
          );
        })}
      </div>

      {/* Data Sources */}
      {regionInfo?.dataSourceUrls && regionInfo.dataSourceUrls.length > 0 && (
        <div className="mt-12 pt-8 border-t border-gray-100">
          <h3 className="text-sm font-medium text-[#555555] uppercase tracking-wider mb-3">
            Data Sources
          </h3>
          <ul className="space-y-2">
            {regionInfo.dataSourceUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
