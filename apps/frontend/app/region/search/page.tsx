"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  REGION_SEARCH,
  type RegionSearchData,
  type RegionSearchItem,
  type RegionSearchVars,
  type SearchBillResult,
  type SearchPropositionResult,
  type SearchResultType,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import { LoadingSkeleton } from "@/components/region/ListStates";
import { PropositionStatusBadge } from "@/components/region/PropositionStatusBadge";
import { BillCardHeader } from "@/components/region/BillCardHeader";
import { SnippetText } from "@/components/search/SnippetText";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 150;

type TypeFilter = SearchResultType | "";

function BillResultCard({
  bill,
  snippet,
}: {
  readonly bill: SearchBillResult;
  readonly snippet?: string | null;
}) {
  return (
    <Link
      href={`/region/bills/${bill.id}`}
      className="block rounded-lg border border-line bg-surface p-5"
    >
      <BillCardHeader bill={bill} />
      {snippet && (
        <p className="mt-2 text-sm text-content-dim line-clamp-2">
          <SnippetText text={snippet} />
        </p>
      )}
      {bill.lastAction && (
        <div className="mt-3 flex items-baseline gap-2 text-xs text-content-dim">
          <span className="whitespace-nowrap">
            {bill.lastActionDate ? formatDate(bill.lastActionDate) : ""}
          </span>
          <span className="line-clamp-1">{bill.lastAction}</span>
        </div>
      )}
    </Link>
  );
}

function PropositionResultCard({
  proposition,
  snippet,
}: {
  readonly proposition: SearchPropositionResult;
  readonly snippet?: string | null;
}) {
  const { t } = useTranslation("region");
  return (
    <Link
      href={`/region/propositions/${proposition.id}`}
      className="block rounded-lg border border-line bg-surface p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-surface-alt px-2.5 py-0.5 text-xs font-semibold text-content-dim">
          {t("search.propChip")}
        </span>
        <span className="font-mono text-sm font-semibold text-content-dim">
          {proposition.externalId}
        </span>
        {proposition.electionDate && (
          <span className="text-xs text-content-dim">
            {t("search.electionLabel", {
              date: formatDate(proposition.electionDate),
            })}
          </span>
        )}
        <PropositionStatusBadge status={proposition.status} />
      </div>
      <h3 className="text-base font-semibold text-content line-clamp-2">
        {proposition.title}
      </h3>
      {snippet && (
        <p className="mt-2 text-sm text-content-dim line-clamp-2">
          <SnippetText text={snippet} />
        </p>
      )}
    </Link>
  );
}

function ResultCard({ item }: { readonly item: RegionSearchItem }) {
  return item.result.__typename === "Bill" ? (
    <BillResultCard bill={item.result} snippet={item.snippet} />
  ) : (
    <PropositionResultCard proposition={item.result} snippet={item.snippet} />
  );
}

function TypeOption({
  label,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        selected
          ? "bg-accent text-on-accent"
          : "text-content-dim hover:bg-surface-alt"
      }`}
    >
      {label}
    </button>
  );
}

function SearchPageInner() {
  const { t, i18n } = useTranslation("region");
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get("q") ?? "";
  // Narrowed by guard, never asserted: a hand-edited ?type=bogus would
  // otherwise be sent as a SearchResultType enum, fail GraphQL coercion,
  // and render the hard error state for a query that has results.
  const rawType = searchParams.get("type");
  const urlType: TypeFilter =
    rawType === "BILL" || rawType === "PROPOSITION" ? rawType : "";

  const [input, setInput] = useState(urlQuery);
  const [page, setPage] = useState(0);

  // The URL is the source of truth (shareable, back-button-safe), and the
  // sync runs BOTH ways.
  //
  // Inbound: adopt an externally-changed ?q — the header search used from
  // this very page, or the Back button. Without it the change was
  // silently reverted, because this component does not remount on a
  // same-route push, so stale local `input` won the next debounce tick
  // and replaced the URL back (#1154 review).
  //
  // Done during render, not in an effect: React's documented "adjusting
  // state when a prop changes" pattern re-renders before paint with no
  // cascading effect pass (an effect here also trips
  // react-hooks/set-state-in-effect).
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery);
    setInput(urlQuery);
    setPage(0);
  }

  // Outbound: typing debounces into the URL. Once the inbound sync above
  // has run, `input` already equals `urlQuery` for external changes, so
  // this no-ops rather than fighting them.
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = input.trim();
      if (trimmed === urlQuery) return;
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      if (urlType) params.set("type", urlType);
      const queryString = trimmed ? `?${params}` : "";
      router.replace(`/region/search${queryString}`);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input, urlQuery, urlType, router]);

  function setType(type: TypeFilter) {
    const params = new URLSearchParams();
    if (urlQuery) params.set("q", urlQuery);
    if (type) params.set("type", type);
    router.replace(`/region/search?${params}`);
    setPage(0);
  }

  const { data, loading, error } = useQuery<RegionSearchData, RegionSearchVars>(
    REGION_SEARCH,
    {
      variables: {
        query: urlQuery,
        ...(urlType && { type: urlType }),
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      },
      skip: !urlQuery,
      fetchPolicy: "cache-and-network",
    },
  );

  const result = data?.regionSearch;

  // `total` is the FILTERED match count; billCount/propositionCount are
  // corpus-wide (so the facet chips can advertise what switching would
  // show). Printing both scales in one sentence contradicts itself —
  // "40 results — 40 bills · 5 propositions" — so the breakdown is only
  // used when nothing is filtered (#1154 review).
  const summaryKey = urlType ? "search.summaryFiltered" : "search.summary";
  const summaryText = result
    ? t(summaryKey, {
        count: result.total,
        total: result.total,
        query: urlQuery,
        bills: result.billCount,
        propositions: result.propositionCount,
      })
    : "";

  // Announcement text for the persistent live region below. Screen
  // readers do not reliably announce a live region that is inserted
  // together with its content, and the empty branch previously had none
  // at all — so a search returning nothing said nothing (#1154 review).
  const announcement = (() => {
    if (!urlQuery || loading) return "";
    if (error) return t("search.error.title");
    if (!result || result.items.length === 0) {
      return t("search.empty.title", { query: urlQuery });
    }
    return summaryText;
  })();

  const renderResults = () => {
    if (!urlQuery) {
      return <p className="text-content-dim">{t("search.prompt")}</p>;
    }
    if (error) {
      // A failed search must say so — never render as "no results".
      return (
        <div
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-surface p-6 text-center"
        >
          <p className="font-semibold text-danger">{t("search.error.title")}</p>
          <p className="mt-1 text-sm text-danger">{t("search.error.body")}</p>
        </div>
      );
    }
    if (loading && !data) return <LoadingSkeleton />;
    if (!result || result.items.length === 0) {
      return (
        <div className="rounded-lg border border-line bg-surface-alt p-8 text-center">
          <p className="font-semibold text-content">
            {t("search.empty.title", { query: urlQuery })}
          </p>
          <p className="mt-1 text-sm text-content-dim">
            {t("search.empty.body")}
          </p>
          {i18n.language === "es" && (
            <p className="mt-1 text-sm text-content-dim">
              {t("search.empty.languageNote")}
            </p>
          )}
        </div>
      );
    }
    return (
      <>
        {/* aria-hidden: the same text is announced by the persistent
            live region below, and AT should hear it once. */}
        <p aria-hidden="true" className="mb-5 text-sm text-content-dim">
          {summaryText}
        </p>
        <div className="space-y-3">
          {result.items.map((item) => (
            <ResultCard
              key={`${item.result.__typename}-${item.result.id}`}
              item={item}
            />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={result.total}
          hasMore={result.hasMore}
          onPageChange={setPage}
        />
      </>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-12">
      <Breadcrumb
        segments={[
          { label: t("breadcrumb.region"), href: "/region" },
          { label: t("search.title") },
        ]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content">{t("search.title")}</h1>
        <p className="mt-2 text-content-dim">{t("search.subtitle")}</p>
      </div>

      <label className="mb-6 block">
        <span className="sr-only">{t("search.inputLabel")}</span>
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("search.pagePlaceholder")}
          aria-label={t("search.inputLabel")}
          className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-content placeholder:text-content-dim focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>

      {urlQuery && (
        <div
          role="radiogroup"
          aria-label={t("search.typeFilterLabel")}
          className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm"
        >
          <TypeOption
            label={t("search.types.all", {
              count: (result?.billCount ?? 0) + (result?.propositionCount ?? 0),
            })}
            selected={urlType === ""}
            onSelect={() => setType("")}
          />
          <TypeOption
            label={t("search.types.bills", { count: result?.billCount ?? 0 })}
            selected={urlType === "BILL"}
            onSelect={() => setType("BILL")}
          />
          <TypeOption
            label={t("search.types.propositions", {
              count: result?.propositionCount ?? 0,
            })}
            selected={urlType === "PROPOSITION"}
            onSelect={() => setType("PROPOSITION")}
          />
        </div>
      )}

      {/* Mounted unconditionally so assistive tech is already observing it
          when the text changes — a live region inserted with its content
          is not reliably announced. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {renderResults()}
    </div>
  );
}

export default function SearchPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <SearchPageInner />
    </Suspense>
  );
}
