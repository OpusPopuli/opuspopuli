"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import {
  GET_REPRESENTATIVE,
  RepresentativeData,
  IdVars,
  CommitteeAssignment,
} from "@/lib/graphql/region";
import { ContactRepresentativeForm } from "@/components/email/ContactRepresentativeForm";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { LoadingSkeleton, ErrorState } from "@/components/region/ListStates";
import { PartyBadge } from "@/components/region/PartyBadge";

const SOURCE_URLS: Record<string, { label: string; url: string }> = {
  Assembly: {
    label: "California State Assembly",
    url: "https://www.assembly.ca.gov/assemblymembers",
  },
  Senate: {
    label: "California State Senate",
    url: "https://www.senate.ca.gov/senators",
  },
};

function SourceAttribution({
  chamber,
  updatedAt,
}: {
  readonly chamber: string;
  readonly updatedAt?: string;
}) {
  const source = SOURCE_URLS[chamber];
  if (!source) return null;

  return (
    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-[#94a3b8]">
      <span>
        Source:{" "}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[#64748b] hover:underline"
        >
          {source.label}
        </a>
      </span>
      {updatedAt && (
        <span>Last synced: {new Date(updatedAt).toLocaleDateString()}</span>
      )}
    </div>
  );
}

function isLeadershipRole(role?: string): boolean {
  return !!role && /chair|ranking/i.test(role);
}

function CommitteeRow({ c }: { readonly c: CommitteeAssignment }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-2">
        {c.url ? (
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            {c.name}
          </a>
        ) : (
          <span className="text-sm text-[#334155]">{c.name}</span>
        )}
      </div>
      {c.role && (
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isLeadershipRole(c.role)
              ? "bg-blue-50 text-blue-700"
              : "bg-gray-100 text-[#64748b]"
          }`}
        >
          {c.role}
        </span>
      )}
    </div>
  );
}

function ContactSection({
  label,
  icon,
  children,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-5 h-5 mt-0.5 text-gray-400">{icon}</div>
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-0.5">
          {label}
        </p>
        <div className="text-sm text-[#222222]">{children}</div>
      </div>
    </div>
  );
}

export default function RepresentativeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [showContactForm, setShowContactForm] = useState(false);

  const { data, loading, error } = useQuery<RepresentativeData, IdVars>(
    GET_REPRESENTATIVE,
    { variables: { id }, fetchPolicy: "cache-and-network" },
  );

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <LoadingSkeleton count={1} height="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <ErrorState entity="representative" />
      </div>
    );
  }

  const rep = data?.representative;

  if (!rep) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#4d4d4d] mb-4">Representative not found.</p>
          <Link
            href="/region/representatives"
            className="text-blue-600 hover:text-blue-700 hover:underline text-sm font-medium"
          >
            Back to Representatives
          </Link>
        </div>
      </div>
    );
  }

  const contact = rep.contactInfo;
  const hasContact =
    contact?.email ||
    contact?.website ||
    (contact?.offices && contact.offices.length > 0);

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <Breadcrumb
        segments={[
          { label: "Region", href: "/region" },
          { label: "Representatives", href: "/region/representatives" },
          { label: rep.name },
        ]}
      />

      {/* Hero Section */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 mb-6">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          {/* Photo */}
          <div className="flex-shrink-0">
            {rep.photoUrl ? (
              <Image
                src={rep.photoUrl}
                alt={rep.name}
                width={120}
                height={120}
                className="w-28 h-28 rounded-full object-cover shadow-md"
                unoptimized
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-gray-200 flex items-center justify-center shadow-md">
                <svg
                  className="w-14 h-14 text-gray-400"
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

          {/* Name & Details */}
          <div className="flex-1">
            <h1 className="text-2xl font-extrabold text-[#222222] mb-2">
              {rep.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <PartyBadge party={rep.party} size="md" />
              <span className="text-sm text-[#4d4d4d] font-medium">
                {rep.chamber}
              </span>
              <span className="text-sm text-[#4d4d4d]">
                District {rep.district}
              </span>
            </div>

            {/* Contact Button */}
            {contact?.email && (
              <button
                onClick={() => setShowContactForm(true)}
                className="mt-2 px-5 py-2.5 text-sm font-medium text-white bg-[#222222] rounded-lg hover:bg-[#333333] transition-colors"
              >
                Contact {rep.name.split(" ")[0]}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bio Section */}
      {rep.bio && (
        <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 mb-6">
          <h2 className="text-xs font-bold uppercase tracking-[1.5px] text-[#595959] mb-3">
            Biography
          </h2>
          <p className="text-[#334155] leading-relaxed">{rep.bio}</p>
        </div>
      )}

      {/* Contact Information */}
      {hasContact && (
        <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 mb-6">
          <h2 className="text-xs font-bold uppercase tracking-[1.5px] text-[#595959] mb-4">
            Contact Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {contact?.email && (
              <ContactSection
                label="Email"
                icon={
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                }
              >
                <a
                  href={`mailto:${contact.email}`}
                  className="text-blue-600 hover:text-blue-700 hover:underline"
                >
                  {contact.email}
                </a>
              </ContactSection>
            )}
            {contact?.website && (
              <ContactSection
                label="Website"
                icon={
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                    />
                  </svg>
                }
              >
                <a
                  href={contact.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 hover:underline"
                >
                  {contact.website}
                </a>
              </ContactSection>
            )}
          </div>

          {/* Office Locations */}
          {contact?.offices && contact.offices.length > 0 && (
            <div className="mt-6 space-y-4">
              {contact.offices.map((office) => (
                <div
                  key={`${office.name}-${office.address ?? ""}`}
                  className="border border-gray-100 rounded-lg p-4"
                >
                  <h3 className="text-sm font-semibold text-[#334155] mb-2">
                    {office.name}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-[#64748b]">
                    {office.address && (
                      <div className="flex items-start gap-2">
                        <svg
                          className="w-4 h-4 mt-0.5 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                        <span>{office.address}</span>
                      </div>
                    )}
                    {office.phone && (
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-4 h-4 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                          />
                        </svg>
                        <a
                          href={`tel:${office.phone}`}
                          className="text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          {office.phone}
                        </a>
                      </div>
                    )}
                    {office.fax && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[#94a3b8]">
                          Fax:
                        </span>
                        <span>{office.fax}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <SourceAttribution chamber={rep.chamber} updatedAt={rep.updatedAt} />
        </div>
      )}

      {/* Committee Assignments */}
      {rep.committees &&
        rep.committees.length > 0 &&
        (() => {
          const leadership = rep.committees.filter((c) =>
            isLeadershipRole(c.role),
          );
          const membership = rep.committees.filter(
            (c) => !isLeadershipRole(c.role),
          );

          return (
            <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 mb-6">
              <h2 className="text-xs font-bold uppercase tracking-[1.5px] text-[#595959] mb-4">
                Committee Assignments
              </h2>

              {leadership.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-xs font-semibold text-[#334155] uppercase tracking-wider mb-2">
                    Leadership
                  </h3>
                  <div className="space-y-1">
                    {leadership.map((c) => (
                      <CommitteeRow key={c.name} c={c} />
                    ))}
                  </div>
                </div>
              )}

              {membership.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#334155] uppercase tracking-wider mb-2">
                    Member
                  </h3>
                  <div className="space-y-1">
                    {membership.map((c) => (
                      <CommitteeRow key={c.name} c={c} />
                    ))}
                  </div>
                </div>
              )}
              <SourceAttribution
                chamber={rep.chamber}
                updatedAt={rep.updatedAt}
              />
            </div>
          );
        })()}

      {/* Campaign Finance - Coming Soon */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 mb-6">
        <h2 className="text-xs font-bold uppercase tracking-[1.5px] text-[#595959] mb-4">
          Campaign Finance
        </h2>
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
            Coming Soon
          </p>
          <p className="text-sm text-slate-700">
            Campaign contributions, expenditures, and independent spending data
            will be linked here.
          </p>
        </div>
      </div>

      {/* Contact Modal */}
      {showContactForm && contact?.email && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <ContactRepresentativeForm
              representative={{
                id: rep.id,
                name: rep.name,
                email: contact.email,
                chamber: rep.chamber,
              }}
              onSuccess={() => {
                setShowContactForm(false);
              }}
              onCancel={() => setShowContactForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
