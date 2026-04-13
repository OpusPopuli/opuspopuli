"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_REGION_INFO,
  GET_REPRESENTATIVES_BY_DISTRICTS,
  RegionInfoData,
  RepresentativesByDistrictsData,
  DataType,
} from "@/lib/graphql/region";
import { GET_MY_ADDRESSES, type MyAddressesData } from "@/lib/graphql/profile";
import { PartyBadge } from "@/components/region/PartyBadge";

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
  CAMPAIGN_FINANCE: {
    title: "Campaign Finance",
    description: "Committees, contributions, and expenditures",
    href: "/region/campaign-finance",
    icon: "finance",
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
    case "finance":
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
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    default:
      return null;
  }
}

function MyRepresentativesSection() {
  // Get user's primary address with district info
  const { data: addressData } = useQuery<MyAddressesData>(GET_MY_ADDRESSES);

  const primaryAddress = addressData?.myAddresses?.find((a) => a.isPrimary);
  const hasDistricts =
    primaryAddress?.congressionalDistrict ||
    primaryAddress?.stateSenatorialDistrict ||
    primaryAddress?.stateAssemblyDistrict;

  // Fetch matching representatives
  const { data: repData } = useQuery<RepresentativesByDistrictsData>(
    GET_REPRESENTATIVES_BY_DISTRICTS,
    {
      variables: {
        congressionalDistrict: primaryAddress?.congressionalDistrict,
        stateSenatorialDistrict: primaryAddress?.stateSenatorialDistrict,
        stateAssemblyDistrict: primaryAddress?.stateAssemblyDistrict,
      },
      skip: !hasDistricts,
    },
  );

  const reps = repData?.representativesByDistricts;

  // Don't show section if no address or no districts
  if (!hasDistricts || !reps || reps.length === 0) {
    if (!primaryAddress) {
      return (
        <div className="mb-10 bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-lg font-semibold text-[#222222] mb-2">
            My Representatives
          </h2>
          <p className="text-sm text-[#4d4d4d] mb-3">
            Add an address in your{" "}
            <Link
              href="/settings/addresses"
              className="text-[#222222] underline font-medium"
            >
              profile settings
            </Link>{" "}
            to see your elected representatives.
          </p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mb-10">
      <h2 className="text-lg font-semibold text-[#222222] mb-4">
        My Representatives
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reps.map((rep) => (
          <Link
            key={rep.id}
            href={`/region/representatives/${rep.id}`}
            className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow flex items-center gap-3"
          >
            {rep.photoUrl ? (
              <Image
                src={rep.photoUrl}
                alt={rep.name}
                width={48}
                height={48}
                className="w-12 h-12 rounded-full object-cover"
                unoptimized
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-6 h-6 text-gray-400"
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
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[#222222] truncate">{rep.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <PartyBadge party={rep.party} />
                <span className="text-xs text-[#4d4d4d]">{rep.chamber}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
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
      {/* My Representatives */}
      <MyRepresentativesSection />

      {/* Region Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-[#222222]">
          {regionInfo?.name || "Region"}
        </h1>
        <p className="mt-2 text-[#4d4d4d]">
          {regionInfo?.description || "Explore civic data for your region"}
        </p>
        {regionInfo?.timezone && (
          <p className="mt-1 text-sm text-[#4d4d4d]">
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
              <div className="text-[#4d4d4d] group-hover:text-[#222222] transition-colors mb-4">
                <DataTypeIcon type={card.icon} />
              </div>
              <h2 className="text-lg font-semibold text-[#222222] group-hover:text-blue-600 transition-colors">
                {card.title}
              </h2>
              <p className="mt-1 text-sm text-[#4d4d4d]">{card.description}</p>
            </Link>
          );
        })}
      </div>

      {/* Data Sources */}
      {regionInfo?.dataSourceUrls && regionInfo.dataSourceUrls.length > 0 && (
        <div className="mt-12 pt-8 border-t border-gray-100">
          <h3 className="text-sm font-medium text-[#4d4d4d] uppercase tracking-wider mb-3">
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
