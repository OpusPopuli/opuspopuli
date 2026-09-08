"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_PROPOSITIONS,
  PropositionsData,
  PropositionsVars,
  Proposition,
  type PropositionStatus,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { PropositionStatusBadge } from "@/components/region/PropositionStatusBadge";
import { Pagination } from "@/components/region/Pagination";
import { ListSearchInput } from "@/components/region/ListSearchInput";
import { NoSearchResults } from "@/components/region/NoSearchResults";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";

const PAGE_SIZE = 10;

/**
 * Pick the best one-line description for a proposition card.
 *
 * Priority:
 *   1. analysisSummary — AI-generated plain-language one-liner. Always
 *      better than the raw scrape when available.
 *   2. summary, but only if it differs from title. The SOS listing-page
 *      scrape pulls the same anchor text into both fields, so summary
 *      often duplicates title; suppress that case rather than render a
 *      pointless second copy.
 *   3. null — caller renders a soft "Analysis pending" hint.
 */
function pickDescription(proposition: Proposition): string | null {
  const analysis = proposition.analysisSummary?.trim();
  if (analysis) return analysis;

  const summary = proposition.summary?.trim();
  if (summary && summary !== proposition.title.trim()) return summary;

  return null;
}

function PropositionCard({
  proposition,
}: Readonly<{ proposition: Proposition }>) {
  const electionDate = proposition.electionDate
    ? new Date(proposition.electionDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  const description = pickDescription(proposition);

  return (
    <Link
      href={`/region/propositions/${proposition.id}`}
      prefetch={false}
      className="block bg-surface rounded-lg p-6 transition-shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-content line-clamp-2">
            {proposition.title}
          </h3>
          {description ? (
            <p className="mt-2 text-sm text-content-dim line-clamp-3">
              {description}
            </p>
          ) : (
            <p className="mt-2 text-sm italic text-content-dim">
              Plain-language summary pending AI analysis.
            </p>
          )}
        </div>
        <PropositionStatusBadge status={proposition.status} />
      </div>

      {electionDate && (
        <div className="mt-4 text-sm text-content-dim">
          Election: {electionDate}
        </div>
      )}
    </Link>
  );
}

const STATUS_FILTERS: readonly PropositionStatus[] = [
  "PENDING",
  "PASSED",
  "FAILED",
  "WITHDRAWN",
];

export default function PropositionsPage() {
  const { t } = useTranslation("region");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<PropositionStatus | "">("");

  const variables: PropositionsVars = {
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
    ...(search && { search }),
    ...(status && { status }),
  };

  const { data, loading, error } = useQuery<PropositionsData, PropositionsVars>(
    GET_PROPOSITIONS,
    { variables },
  );

  const hasFilters = !!(search || status);

  function clearAll() {
    setSearch("");
    setSearchKey((k) => k + 1);
    setStatus("");
    setPage(0);
    // The remount above would otherwise drop focus to <body>; the search
    // box is also the most useful place to land.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  // Announced on change, covering the empty case too — a search that
  // returns nothing previously said nothing.
  const announcement = (() => {
    if (loading || !data) return "";
    if (!search) return "";
    return data.propositions.total === 0
      ? t("search.empty.title", { query: search })
      : t("search.matchCount", {
          count: data.propositions.total,
          query: search,
        });
  })();

  const renderContent = () => {
    if (loading && !data) return <LoadingSkeleton />;
    if (error) return <ErrorState entity="propositions" />;
    if (data?.propositions.items.length === 0) {
      // "No propositions found" is false when the corpus is fine and the
      // query simply matched nothing.
      return search ? (
        <NoSearchResults query={search} />
      ) : (
        <EmptyState entity="propositions" />
      );
    }

    return (
      <>
        <div className="space-y-4">
          {data?.propositions.items.map((prop) => (
            <PropositionCard key={prop.id} proposition={prop} />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.propositions.total || 0}
          hasMore={data?.propositions.hasMore || false}
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
          { label: "Propositions" },
        ]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content">Propositions</h1>
        <p className="mt-2 text-content-dim">
          Ballot measures and initiatives for your region
        </p>
      </div>

      <div className="mb-3">
        <ListSearchInput
          key={searchKey}
          inputRef={searchInputRef}
          label={t("search.propositionsInputLabel")}
          placeholder={t("search.propositionsPlaceholder")}
          onSearch={(value) => {
            if (value === search) return;
            setSearch(value);
            setPage(0);
          }}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as PropositionStatus | "");
            setPage(0);
          }}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content-dim focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label={t("search.statusFilterLabel")}
        >
          <option value="">{t("search.allStatuses")}</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`propositionStatus.${s}`)}
            </option>
          ))}
        </select>

        {/* Mounted-but-disabled rather than conditional: clicking it
            unmounts the condition, which would destroy the focused
            element mid-interaction. */}
        <button
          type="button"
          onClick={clearAll}
          disabled={!hasFilters}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content-dim hover:bg-surface-alt disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("search.clearFilters")}
        </button>
      </div>

      {search && data && !loading && (
        <p className="mb-3 text-sm text-content-dim">
          {t("search.matchCount", {
            count: data.propositions.total,
            query: search,
          })}
        </p>
      )}

      {/* Mounted unconditionally so assistive tech is already observing it
          when the text changes — a live region inserted together with its
          content is not reliably announced (the lesson from #1154). */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {renderContent()}
    </div>
  );
}
