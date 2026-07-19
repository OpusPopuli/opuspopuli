"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_REPRESENTATIVES,
  GET_REPRESENTATIVES_BY_DISTRICTS,
  MY_COUNTY_SUPERVISORS,
  RepresentativesData,
  RepresentativesByDistrictsData,
  MyCountySupervisorsData,
  Representative,
} from "@/lib/graphql/region";
import { GET_MY_ADDRESSES, type MyAddressesData } from "@/lib/graphql/profile";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";
import { PartyBadge } from "@/components/region/PartyBadge";

const PAGE_SIZE = 12;

function RepresentativeCard({
  representative,
}: Readonly<{ representative: Representative }>) {
  return (
    <Link
      href={`/region/representatives/${representative.id}`}
      className="block bg-surface rounded-lg p-6 transition-shadow"
    >
      <div className="flex items-start gap-4">
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
            <div className="w-16 h-16 rounded-full bg-surface-sunk flex items-center justify-center">
              <svg
                className="w-8 h-8 text-content-dim"
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

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-content">
            {representative.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <PartyBadge party={representative.party} />
            <span className="text-sm text-content-dim">
              {representative.chamber}
            </span>
          </div>
          <p className="mt-1 text-sm text-content-dim">
            District {representative.district}
          </p>
        </div>

        <svg
          className="w-5 h-5 text-content-dim flex-shrink-0 mt-1"
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

function RepGroup({
  title,
  reps,
}: Readonly<{ title: string; reps: Representative[] }>) {
  if (reps.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-content-dim mb-3">
        {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reps.map((rep) => (
          <RepresentativeCard key={rep.id} representative={rep} />
        ))}
      </div>
    </div>
  );
}

function MyRepresentativesSection({
  stateReps,
  countyReps,
  addressLoaded,
  hasAddress,
}: Readonly<{
  stateReps: Representative[];
  countyReps: Representative[];
  addressLoaded: boolean;
  hasAddress: boolean;
}>) {
  if (!addressLoaded) return null;

  if (!hasAddress) {
    return (
      <div className="mb-10 bg-surface rounded-lg p-6">
        <h2 className="text-xl font-semibold text-content mb-2">
          My Representatives
        </h2>
        <p className="text-sm text-content-dim">
          Add an address in your{" "}
          <Link
            href="/settings/addresses"
            className="text-content underline font-medium"
          >
            profile settings
          </Link>{" "}
          to see your elected representatives.
        </p>
      </div>
    );
  }

  if (stateReps.length === 0 && countyReps.length === 0) return null;

  return (
    <div className="mb-10">
      <h2 className="text-xl font-semibold text-content mb-6">
        My Representatives
      </h2>
      <div className="space-y-6">
        <RepGroup title="State" reps={stateReps} />
        <RepGroup title="County" reps={countyReps} />
      </div>
    </div>
  );
}

export default function RepresentativesPage() {
  const [page, setPage] = useState(0);
  const [chamber, setChamber] = useState<string | undefined>(undefined);

  const { data: addressData } = useQuery<MyAddressesData>(GET_MY_ADDRESSES);
  const primaryAddress = addressData?.myAddresses?.find((a) => a.isPrimary);
  const hasDistricts =
    primaryAddress?.congressionalDistrict ||
    primaryAddress?.stateSenatorialDistrict ||
    primaryAddress?.stateAssemblyDistrict;

  const { data: stateRepData } = useQuery<RepresentativesByDistrictsData>(
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

  const { data: supervisorsData } = useQuery<MyCountySupervisorsData>(
    MY_COUNTY_SUPERVISORS,
  );

  const myRepIds = useMemo(() => {
    const ids = new Set<string>();
    stateRepData?.representativesByDistricts?.forEach((r) => ids.add(r.id));
    supervisorsData?.myCountySupervisors?.forEach((r) => ids.add(r.id));
    return ids;
  }, [stateRepData, supervisorsData]);

  const stateReps = stateRepData?.representativesByDistricts ?? [];
  const countyReps = supervisorsData?.myCountySupervisors ?? [];

  const { data, loading, error } = useQuery<RepresentativesData>(
    GET_REPRESENTATIVES,
    { variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE, chamber } },
  );

  const { data: allData } = useQuery<RepresentativesData>(GET_REPRESENTATIVES, {
    variables: { skip: 0, take: 100 },
  });

  const chambers = allData?.representatives.items
    ? Array.from(
        new Set(allData.representatives.items.map((r) => r.chamber)),
      ).sort((a, b) => a.localeCompare(b))
    : [];

  // Pagination total reflects the unfiltered server count — slightly off when
  // "My Representatives" exclusions reduce a page's visible card count. (#702)
  const masterReps =
    data?.representatives.items.filter((r) => !myRepIds.has(r.id)) ?? [];

  const renderMasterList = () => {
    if (loading) return <LoadingSkeleton count={4} height="h-40" grid />;
    if (error) return <ErrorState entity="representatives" />;
    if (masterReps.length === 0 && myRepIds.size === 0)
      return <EmptyState entity="representatives" />;
    if (masterReps.length === 0)
      return (
        <p className="text-sm text-content-dim">
          All representatives for your area appear above.
        </p>
      );

    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {masterReps.map((rep) => (
            <RepresentativeCard key={rep.id} representative={rep} />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.representatives.total ?? 0}
          hasMore={data?.representatives.hasMore ?? false}
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

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content">Representatives</h1>
        <p className="mt-2 text-content-dim">
          Elected officials and legislators
        </p>
      </div>

      <MyRepresentativesSection
        stateReps={stateReps}
        countyReps={countyReps}
        addressLoaded={addressData !== undefined}
        hasAddress={!!primaryAddress}
      />

      <div>
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h2 className="text-xl font-semibold text-content">
            All Representatives
          </h2>
          {chambers.length > 0 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="chamber"
                className="text-sm font-medium text-content-dim"
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
                className="px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:border-content focus:ring-1 focus:ring-content outline-none"
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

        {renderMasterList()}
      </div>
    </div>
  );
}
