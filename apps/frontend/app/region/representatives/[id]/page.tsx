"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import {
  GET_REPRESENTATIVE,
  GET_BILLS,
  RepresentativeData,
  IdVars,
  BioClaim,
  CommitteeAssignment,
  ContactInfo,
  Office,
  Representative,
  type BillsData,
  type BillsVars,
} from "@/lib/graphql/region";
import { ContactRepresentativeForm } from "@/components/email/ContactRepresentativeForm";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { LoadingSkeleton, ErrorState } from "@/components/region/ListStates";
import { PartyBadge } from "@/components/region/PartyBadge";
import { SectionTitle } from "@/components/region/SectionTitle";
import { ComingSoon } from "@/components/region/ComingSoon";
import { LayerButton } from "@/components/region/LayerButton";
import { LayerNav } from "@/components/region/LayerNav";
import { ActivityStats } from "@/components/region/ActivityStats";
import { ActivityFeed } from "@/components/region/ActivityFeed";
import { ActivitySummary } from "@/components/region/ActivitySummary";
import { CivicTerm } from "@/components/civics/CivicTerm";
import { BillsList } from "@/components/region/BillListItem";

const LAYERS = [
  { n: 1, label: "Who They Are" },
  { n: 2, label: "What They Care About" },
  { n: 3, label: "What They've Done" },
  { n: 4, label: "How They Are Supported" },
] as const;

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

  // Color: slate-600 (#475569) on white ≈ 7:1 contrast (WCAG 2.2 AA pass).
  // slate-400 (#94a3b8) — used previously — was 2.56:1 and failed axe.
  return (
    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-slate-600">
      <span>
        Source:{" "}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-slate-800 hover:underline"
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
  // Three rendering tiers, in priority order:
  //  1. Internal link to the new committee detail page when the linker
  //     resolved a LegislativeCommittee.id for this assignment.
  //  2. External link to the rep-specific scrape URL when present (the
  //     committee detail page doesn't carry that per-rep context).
  //  3. Plain text for the rare case where neither is available.
  const renderName = () => {
    if (c.legislativeCommitteeId) {
      return (
        <Link
          href={`/region/legislative-committees/${c.legislativeCommitteeId}`}
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          {c.name}
        </Link>
      );
    }
    if (c.url) {
      return (
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          {c.name}
        </a>
      );
    }
    return <span className="text-sm text-[#334155]">{c.name}</span>;
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-2">{renderName()}</div>
      {c.role && (
        // Member badge uses slate-700 (#334155) on gray-100 (#f3f4f6) for
        // ~7.5:1 contrast; slate-500 (#64748b) — used previously — was
        // 4.32:1 and failed axe's 4.5:1 threshold at 12px.
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isLeadershipRole(c.role)
              ? "bg-blue-50 text-blue-700"
              : "bg-gray-100 text-slate-700"
          }`}
        >
          {c.role}
        </span>
      )}
    </div>
  );
}

function Bio({ rep }: { readonly rep: Representative }) {
  const [showAttribution, setShowAttribution] = useState(false);

  if (!rep.bio) {
    return (
      <p className="text-sm text-[#64748b] italic mb-8">
        No biography on file. {rep.name} represents District {rep.district} in
        the California {rep.chamber}.
      </p>
    );
  }
  const isAi = rep.bioSource === "ai-generated";
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Biography</SectionTitle>
        {isAi && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
            title="This biography was generated by AI from public record data (name, jurisdiction, district, party)."
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            AI-generated
          </span>
        )}
      </div>
      <div className="text-[#334155] leading-relaxed space-y-3">
        {rep.bio
          .split(/\n\n+/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => (
            <p key={p}>{p}</p>
          ))}
      </div>
      {isAi && (
        <div className="mt-3 flex items-baseline gap-3 text-[11px]">
          <p className="text-[#94a3b8] italic">
            Generated from public record data. May contain inaccuracies — verify
            against official sources before citing.
          </p>
          <button
            type="button"
            onClick={() => setShowAttribution((v) => !v)}
            className="text-slate-600 hover:text-slate-800 hover:underline whitespace-nowrap"
            aria-expanded={showAttribution}
            aria-controls="bio-attribution"
          >
            {showAttribution ? "Hide" : "Show"} per-sentence attribution
          </button>
        </div>
      )}
      {isAi && showAttribution && (
        <div
          id="bio-attribution"
          className="mt-4 pt-4 border-t border-gray-100"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-3">
            Biography Source Attribution
          </h4>
          <BioClaims claims={rep.bioClaims} />
        </div>
      )}
    </div>
  );
}

function Committees({
  committees,
  summary,
}: {
  readonly committees: readonly CommitteeAssignment[];
  readonly summary?: string;
}) {
  const leadership = committees.filter((c) => isLeadershipRole(c.role));
  const membership = committees.filter((c) => !isLeadershipRole(c.role));

  return (
    <div className="mb-8">
      <SectionTitle>Committee Assignments</SectionTitle>

      {summary && (
        <div className="mb-5 p-4 bg-amber-50/40 border-l-4 border-amber-300 rounded-r">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-900">
              At a glance
            </h4>
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 flex-shrink-0"
              title="This summary was generated by AI from the committee assignments listed below."
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              AI-generated
            </span>
          </div>
          <p className="text-sm text-[#334155] leading-relaxed">{summary}</p>
        </div>
      )}

      {leadership.length > 0 && (
        <div className="mb-5">
          <h4 className="text-xs font-semibold text-[#334155] uppercase tracking-wider mb-2">
            Leadership
          </h4>
          <div className="space-y-1">
            {leadership.map((c) => (
              <CommitteeRow key={c.name} c={c} />
            ))}
          </div>
        </div>
      )}

      {membership.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-[#334155] uppercase tracking-wider mb-2">
            Member
          </h4>
          <div className="space-y-1">
            {membership.map((c) => (
              <CommitteeRow key={c.name} c={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Merge offices that share a title (case-insensitive). California Assembly
 * reps have two "Sacramento" entries — the Capitol street address and a
 * mailing PO Box — which read naturally as one office with both addresses.
 * Addresses are joined with newlines; phone/fax take the first non-empty.
 */
function mergeOfficesByName(offices: readonly Office[]): Office[] {
  const byKey = new Map<string, Office>();
  for (const o of offices) {
    const key = o.name.trim().toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...o });
      continue;
    }
    if (o.address && existing.address !== o.address) {
      existing.address = existing.address
        ? `${existing.address}\n${o.address}`
        : o.address;
    }
    existing.phone ??= o.phone;
    existing.fax ??= o.fax;
  }
  return Array.from(byKey.values());
}

function Offices({ contact }: { readonly contact: ContactInfo }) {
  const offices = mergeOfficesByName(contact.offices ?? []);
  if (offices.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionTitle>Where to Reach Them</SectionTitle>
      <div className="space-y-4">
        {offices.map((office) => (
          <div
            key={`${office.name}-${office.address ?? ""}`}
            className="border border-gray-100 rounded-lg p-4"
          >
            <h4 className="text-sm font-semibold text-[#334155] mb-2">
              {office.name}
            </h4>
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
                  <span className="whitespace-pre-line">{office.address}</span>
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
    </div>
  );
}

/**
 * Per-sentence attribution list for an AI-generated bio. Each sentence
 * shows an origin badge (Source / Training) plus an advisory hint —
 * the LLM's best guess at the kind of source behind a training-origin
 * claim. Hints are not verified citations; they orient the reader on
 * where to look to verify.
 */
function BioClaims({ claims }: { readonly claims?: readonly BioClaim[] }) {
  if (!claims || claims.length === 0) {
    return (
      <p className="text-sm text-slate-600 italic">
        No per-sentence attribution was returned by the bio generator.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {claims.map((c, idx) => (
        <li
          key={c.sentence}
          className="text-sm border-l-2 border-gray-200 pl-3"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-mono text-slate-400 flex-shrink-0">
              {idx + 1}.
            </span>
            <span className="text-[#334155] leading-relaxed">{c.sentence}</span>
          </div>
          <div className="mt-1 ml-5 flex flex-wrap items-center gap-2 text-[11px]">
            {c.origin === "source" ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
                Source
              </span>
            ) : (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                Training knowledge
              </span>
            )}
            {c.origin === "source" && c.sourceField && (
              <span className="text-slate-500 font-mono">{c.sourceField}</span>
            )}
            {c.origin === "training" && c.sourceHint && (
              <span className="text-slate-600 italic">— {c.sourceHint}</span>
            )}
            {c.confidence && (
              <span className="text-slate-400">
                ({c.confidence} confidence)
              </span>
            )}
          </div>
        </li>
      ))}
      <li className="text-[11px] text-slate-500 italic pt-2 border-t border-gray-100">
        Training-knowledge hints are advisory and not verified citations. Verify
        against primary sources before citing.
      </li>
    </ol>
  );
}

/** Layer 1 — Who They Are: bio + offices + source attribution. */
function WhoTheyAre({
  rep,
  onNext,
}: {
  readonly rep: Representative;
  readonly onNext: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <Bio rep={rep} />
      {rep.contactInfo && <Offices contact={rep.contactInfo} />}
      <SourceAttribution chamber={rep.chamber} updatedAt={rep.updatedAt} />
      <div className="mt-6">
        <LayerButton onClick={onNext}>What They Care About</LayerButton>
      </div>
    </div>
  );
}

/** Layer 2 — What They Care About: committees. */
function WhatTheyCareAbout({
  rep,
  onNext,
  onBack,
}: {
  readonly rep: Representative;
  readonly onNext: () => void;
  readonly onBack: () => void;
}) {
  const hasCommittees = rep.committees && rep.committees.length > 0;
  return (
    <div className="animate-layer-enter">
      {hasCommittees && rep.committees ? (
        <Committees
          committees={rep.committees}
          summary={rep.committeesSummary}
        />
      ) : (
        <div className="mb-8">
          <SectionTitle>Committee Assignments</SectionTitle>
          <ComingSoon
            title="No committee assignments on file"
            description="Committee data is synced from the official legislature roster; we may not have it yet for this representative."
          />
        </div>
      )}

      <SourceAttribution chamber={rep.chamber} updatedAt={rep.updatedAt} />

      <div className="flex items-center gap-3 mt-6">
        <LayerButton onClick={onNext}>What They&apos;ve Done</LayerButton>
        <LayerButton onClick={onBack} variant="secondary">
          Back
        </LayerButton>
      </div>
    </div>
  );
}

function AuthoredBillsList({
  representativeId,
}: {
  readonly representativeId: string;
}) {
  const { data, loading } = useQuery<BillsData, BillsVars>(GET_BILLS, {
    variables: { authorId: representativeId, take: 10, skip: 0 },
    fetchPolicy: "cache-and-network",
  });

  if (loading && !data) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-12 bg-slate-100 rounded-lg" />
        ))}
      </div>
    );
  }

  const bills = data?.bills?.items ?? [];

  if (bills.length === 0) {
    return (
      <p className="text-sm italic text-slate-400">
        No authored bills found in the current session.
      </p>
    );
  }

  return (
    <BillsList
      bills={bills}
      totalCount={data?.bills?.total ?? 0}
      viewAllHref={`/region/bills?authorId=${representativeId}`}
    />
  );
}

/**
 * Layer 3 — What They've Done. Live activity feed driven by the
 * `legislative_actions` data backing the rep, plus an at-a-glance
 * stats grid. Click "See passage →" on any action card to surface
 * the verbatim source text in L4 (citation panel — Phase 3).
 *
 * Issue #665.
 */
function WhatTheyveDone({
  rep,
  onNext,
  onBack,
  onSeePassage,
}: {
  readonly rep: Representative;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onSeePassage?: (actionId: string) => void;
}) {
  return (
    <div className="animate-layer-enter">
      <ActivitySummary
        summary={rep.activitySummary}
        generatedAt={rep.activitySummaryGeneratedAt}
        windowDays={rep.activitySummaryWindowDays}
      />

      <ActivityStats representativeId={rep.id} />

      <div className="mb-8">
        <SectionTitle>Recent activity</SectionTitle>
        <ActivityFeed representativeId={rep.id} onSeePassage={onSeePassage} />
      </div>

      <div className="mb-8">
        <SectionTitle>Authored Bills</SectionTitle>
        <AuthoredBillsList representativeId={rep.id} />
      </div>

      <div className="flex items-center gap-3">
        <LayerButton onClick={onNext}>How They Are Supported</LayerButton>
        <LayerButton onClick={onBack} variant="secondary">
          Back
        </LayerButton>
      </div>
    </div>
  );
}

/** Layer 4 — How They Are Supported: campaign finance + provenance. */
function HowTheyAreSupported({
  rep,
  onBack,
}: {
  readonly rep: Representative;
  readonly onBack: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <div className="mb-8">
        <SectionTitle>Campaign Finance</SectionTitle>
        <ComingSoon
          title="Coming Soon"
          description="Top contributors, total raised, expenditures, and independent spending supporting or opposing this representative. Tracked in #566."
        />
      </div>

      <div className="bg-[#fafafa] rounded-xl border-l-4 border-[#222222] p-6 mb-8">
        <h3 className="text-sm uppercase tracking-[1.5px] font-bold text-[#222222] mb-4">
          Sources &amp; Attribution
        </h3>
        <ul className="space-y-3">
          {SOURCE_URLS[rep.chamber] && (
            <li>
              <a
                href={SOURCE_URLS[rep.chamber].url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 font-semibold text-sm hover:underline"
              >
                &rarr; Official {SOURCE_URLS[rep.chamber].label} Roster
              </a>
            </li>
          )}
          <li className="text-sm text-slate-600">
            &rarr; Voting Record (coming soon)
          </li>
          <li className="text-sm text-slate-600">
            &rarr; News Coverage (coming soon)
          </li>
          <li className="text-sm text-slate-600">
            &rarr; Campaign Finance Filings (coming soon)
          </li>
        </ul>
        {rep.updatedAt && (
          <p className="text-[11px] text-[#94a3b8] mt-4">
            Last synced: {new Date(rep.updatedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      <LayerButton onClick={onBack} variant="secondary">
        Back to Summary
      </LayerButton>
    </div>
  );
}

/**
 * Compact contact chip used in the persistent header — icon + value
 * with truncation on narrow viewports.
 */
function ContactChip({
  href,
  icon,
  label,
  external,
}: {
  readonly href: string;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="inline-flex items-center gap-1.5 text-xs text-[#475569] hover:text-blue-700 hover:underline max-w-[220px] min-h-[24px]"
    >
      <span className="flex-shrink-0 w-3.5 h-3.5 text-[#94a3b8]">{icon}</span>
      <span className="truncate">{label}</span>
    </a>
  );
}

/** Strip protocol + trailing slash for a compact display URL. */
function displayHostname(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function PersistentHeader({
  rep,
  onContactClick,
}: {
  readonly rep: Representative;
  readonly onContactClick: () => void;
}) {
  const firstName = rep.name.split(" ")[0];
  const contact = rep.contactInfo;
  const primaryPhone = contact?.offices?.find((o) => o.phone)?.phone;
  const hasAnyContact =
    contact && (contact.email || contact.website || primaryPhone);

  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 mb-6">
      <div className="flex flex-col sm:flex-row items-start gap-5">
        <div className="flex-shrink-0">
          {rep.photoUrl ? (
            <Image
              src={rep.photoUrl}
              alt={rep.name}
              width={96}
              height={96}
              className="w-24 h-24 rounded-full object-cover shadow-md"
              unoptimized
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center shadow-md">
              <svg
                className="w-12 h-12 text-gray-400"
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
          <h1 className="text-2xl font-extrabold text-[#222222] mb-1.5 leading-tight">
            {rep.name}
          </h1>

          <div className="flex flex-wrap items-center gap-2.5 mb-2.5">
            <PartyBadge party={rep.party} size="md" />
            <span className="text-sm text-[#4d4d4d] font-medium">
              <CivicTerm term={rep.chamber}>{rep.chamber}</CivicTerm>
            </span>
            <span className="text-sm text-[#4d4d4d]">
              District {rep.district}
            </span>
          </div>

          {hasAnyContact && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
              {contact?.email && (
                <ContactChip
                  href={`mailto:${contact.email}`}
                  label={contact.email}
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
                />
              )}
              {contact?.website && (
                <ContactChip
                  href={contact.website}
                  external
                  label={displayHostname(contact.website)}
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
                />
              )}
              {primaryPhone && (
                <ContactChip
                  href={`tel:${primaryPhone}`}
                  label={primaryPhone}
                  icon={
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                  }
                />
              )}
            </div>
          )}

          {contact?.email && (
            <button
              onClick={onContactClick}
              className="px-4 py-2 text-sm font-medium text-white bg-[#222222] rounded-lg hover:bg-[#333333] transition-colors"
            >
              Contact {firstName}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RepresentativeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [showContactForm, setShowContactForm] = useState(false);
  const [layer, setLayer] = useState(1);

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

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <Breadcrumb
        segments={[
          { label: "Region", href: "/region" },
          { label: "Representatives", href: "/region/representatives" },
          { label: rep.name },
        ]}
      />

      <PersistentHeader
        rep={rep}
        onContactClick={() => setShowContactForm(true)}
      />

      <LayerNav layers={LAYERS} current={layer} onChange={setLayer} />

      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        {layer === 1 && <WhoTheyAre rep={rep} onNext={() => setLayer(2)} />}
        {layer === 2 && (
          <WhatTheyCareAbout
            rep={rep}
            onNext={() => setLayer(3)}
            onBack={() => setLayer(1)}
          />
        )}
        {layer === 3 && (
          <WhatTheyveDone
            rep={rep}
            onNext={() => setLayer(4)}
            onBack={() => setLayer(1)}
          />
        )}
        {layer === 4 && (
          <HowTheyAreSupported rep={rep} onBack={() => setLayer(1)} />
        )}
      </div>

      {showContactForm && rep.contactInfo?.email && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <ContactRepresentativeForm
              representative={{
                id: rep.id,
                name: rep.name,
                email: rep.contactInfo.email,
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
