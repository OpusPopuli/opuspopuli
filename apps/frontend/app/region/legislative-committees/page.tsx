"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_LEGISLATIVE_COMMITTEES,
  LegislativeCommittee,
  LegislativeCommitteesData,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";

const PAGE_SIZE = 10;
/**
 * When the search input is non-empty we bypass server-side
 * pagination and pull a single generous page so the user sees every
 * matching committee on one screen. Capped at 100 because the
 * `PaginationArgs.take` DTO enforces `@Max(100)` server-side. CA
 * today has ~70 committees + subcommittees total, so 100 is enough
 * to surface all matches in any plausible chamber+search filter
 * combination. If a chamber's roster ever exceeds 100, raise the
 * server-side cap or fall back to paginated results.
 */
const SEARCH_PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 150;

const CHAMBER_FILTERS: ReadonlyArray<{ label: string; value?: string }> = [
  { label: "All", value: undefined },
  { label: "Assembly", value: "Assembly" },
  { label: "Senate", value: "Senate" },
];

function ChamberBadge({ chamber }: { readonly chamber: string }) {
  const isAssembly = chamber === "Assembly";
  const cls = isAssembly
    ? "bg-blue-100 text-blue-800"
    : "bg-purple-100 text-purple-800";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {chamber}
    </span>
  );
}

function CommitteeCard({
  committee,
}: Readonly<{ committee: LegislativeCommittee }>) {
  return (
    <Link
      href={`/region/legislative-committees/${committee.id}`}
      className="block bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-[#222222]">
            {committee.name}
          </h3>
          {committee.description ? (
            <p className="mt-2 text-sm text-[#4d4d4d] line-clamp-2">
              {committee.description}
            </p>
          ) : null}
        </div>
        <ChamberBadge chamber={committee.chamber} />
      </div>
      <div className="mt-4 text-sm text-[#4d4d4d]">
        {committee.memberCount}{" "}
        {committee.memberCount === 1 ? "member" : "members"}
      </div>
    </Link>
  );
}

export default function LegislativeCommitteesPage() {
  const [page, setPage] = useState(0);
  const [chamber, setChamber] = useState<string | undefined>(undefined);
  // Two-state debounce: `searchInput` follows keystrokes;
  // `searchQuery` is what we actually send to the server. Keeps the
  // input responsive while throttling network requests.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const isSearching = searchQuery.length > 0;
  const effectivePageSize = isSearching ? SEARCH_PAGE_SIZE : PAGE_SIZE;
  const effectiveSkip = isSearching ? 0 : page * PAGE_SIZE;

  const { data, loading, error } = useQuery<LegislativeCommitteesData>(
    GET_LEGISLATIVE_COMMITTEES,
    {
      variables: {
        skip: effectiveSkip,
        take: effectivePageSize,
        chamber,
        nameFilter: isSearching ? searchQuery : undefined,
      },
    },
  );

  const onChamberChange = (value: string | undefined) => {
    setChamber(value);
    setPage(0);
  };

  const items = data?.legislativeCommittees.items ?? [];
  const total = data?.legislativeCommittees.total ?? 0;
  const hasMore = data?.legislativeCommittees.hasMore ?? false;

  const renderContent = () => {
    if (loading && !data) return <LoadingSkeleton />;
    if (error) return <ErrorState entity="legislative committees" />;

    if (items.length === 0) {
      if (isSearching) {
        return (
          <p className="text-sm text-[#4d4d4d] italic">
            No committees match &ldquo;{searchQuery}&rdquo;. Check spelling or
            try a broader term.
          </p>
        );
      }
      return <EmptyState entity="legislative committees" />;
    }

    return (
      <>
        <div className="space-y-4">
          {items.map((c) => (
            <CommitteeCard key={c.id} committee={c} />
          ))}
        </div>
        {!isSearching && (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            hasMore={hasMore}
            onPageChange={setPage}
          />
        )}
      </>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <Breadcrumb
        segments={[
          { label: "Region", href: "/region" },
          { label: "Legislative Committees" },
        ]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">
          Legislative Committees
        </h1>
        <p className="mt-2 text-[#4d4d4d]">
          Where bills get debated and shaped before they reach the floor. Click
          a committee to see who sits on it and what hearings it has held.
        </p>
      </div>

      <div className="mb-6 space-y-3">
        <label className="block">
          <span className="sr-only">Search committees</span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search committees by name (e.g. 'Health', 'Veterans')…"
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-[#222222] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            aria-label="Search committees by name"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {CHAMBER_FILTERS.map((f) => {
            const active = chamber === f.value;
            return (
              <button
                key={f.label}
                type="button"
                onClick={() => onChamberChange(f.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#222222] text-white"
                    : "bg-white text-[#4d4d4d] hover:bg-slate-100"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {isSearching && !loading && items.length > 0 && (
        <p className="mb-3 text-xs text-[#4d4d4d]">
          {total} match{total === 1 ? "" : "es"} for &ldquo;{searchQuery}
          &rdquo;
        </p>
      )}

      {renderContent()}
    </div>
  );
}
