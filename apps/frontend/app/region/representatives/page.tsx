"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@apollo/client/react";
import {
  GET_REPRESENTATIVES,
  RepresentativesData,
  Representative,
} from "@/lib/graphql/region";
import { ContactRepresentativeForm } from "@/components/email/ContactRepresentativeForm";
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
  onContact,
}: Readonly<{ representative: Representative; onContact: () => void }>) {
  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow">
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
            <span className="text-sm text-[#555555]">
              {representative.chamber}
            </span>
          </div>
          <p className="mt-1 text-sm text-[#555555]">
            District {representative.district}
          </p>
        </div>
      </div>

      {/* Contact Info */}
      {representative.contactInfo && (
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-2 text-sm">
          {representative.contactInfo.email && (
            <a
              href={`mailto:${representative.contactInfo.email}`}
              className="text-blue-600 hover:text-blue-700 hover:underline truncate"
            >
              {representative.contactInfo.email}
            </a>
          )}
          {representative.contactInfo.phone && (
            <a
              href={`tel:${representative.contactInfo.phone}`}
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              {representative.contactInfo.phone}
            </a>
          )}
          {representative.contactInfo.office && (
            <span className="text-[#555555] col-span-2 truncate">
              {representative.contactInfo.office}
            </span>
          )}
          {representative.contactInfo.website && (
            <a
              href={representative.contactInfo.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 hover:underline truncate"
            >
              Website
            </a>
          )}
        </div>
      )}

      {/* Contact Button */}
      {representative.contactInfo?.email && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <button
            onClick={onContact}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-[#222222] rounded-lg hover:bg-[#333333] transition-colors"
          >
            Contact {representative.name.split(" ")[0]}
          </button>
        </div>
      )}
    </div>
  );
}

export default function RepresentativesPage() {
  const [page, setPage] = useState(0);
  const [chamber, setChamber] = useState<string | undefined>(undefined);
  const [contactRep, setContactRep] = useState<Representative | null>(null);

  const { data, loading, error } = useQuery<RepresentativesData>(
    GET_REPRESENTATIVES,
    {
      variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE, chamber },
    },
  );

  // Get unique chambers from data for filter
  const chambers = data?.representatives.items
    ? Array.from(new Set(data.representatives.items.map((r) => r.chamber)))
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
            <RepresentativeCard
              key={rep.id}
              representative={rep}
              onContact={() => setContactRep(rep)}
            />
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
          <p className="mt-2 text-[#555555]">
            Elected officials and legislators
          </p>
        </div>

        {/* Chamber Filter */}
        {chambers.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="chamber"
              className="text-sm font-medium text-[#555555]"
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

      {/* Contact Modal */}
      {contactRep && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <ContactRepresentativeForm
              representative={{
                id: contactRep.id,
                name: contactRep.name,
                email: contactRep.contactInfo?.email || "",
                chamber: contactRep.chamber,
              }}
              onSuccess={() => {
                setContactRep(null);
                alert("Message sent successfully!");
              }}
              onCancel={() => setContactRep(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
