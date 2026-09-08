"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_BILLS,
  BillLifecycle,
  type BillsData,
  type BillsVars,
  type Bill,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { Pagination } from "@/components/region/Pagination";
import {
  LoadingSkeleton,
  ErrorState,
  EmptyState,
} from "@/components/region/ListStates";
import { BillCardHeader } from "@/components/region/BillCardHeader";
import { useCivics } from "@/components/civics/CivicsContext";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 20;

/**
 * One option in the Active/Inactive segmented filter. Uses the WAI-ARIA
 * radio pattern (mutually-exclusive within a parent radiogroup) rather
 * than the tabs pattern, since the buttons don't control tab panels.
 * Focus ring matches the rest of the page's controls.
 */
function LifecycleOption({
  value,
  label,
  selected,
  onSelect,
}: {
  readonly value: BillLifecycle;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-value={value}
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

function BillCard({ bill }: Readonly<{ bill: Bill }>) {
  return (
    <Link
      href={`/region/bills/${bill.id}`}
      // prefetch={false}: the App Router prefetches every Link entering
      // the viewport, so a 20-card page fired 20 separate RSC requests to
      // the Worker. Each is cheap on its own — these detail routes are
      // "use client", so the server emits a client reference rather than
      // rendering the page body — but the per-invocation overhead and
      // layout chain, multiplied across every list in the app, is what
      // pushed the Cloudflare Worker past its resource ceiling (Error
      // 1102). That surfaced as "cannot log in", because the login page
      // was one of the renders that failed (#1174).
      //
      // `false` and not `"auto"`: with no loading.tsx anywhere in the
      // app, "auto" still issues one request per link, and request COUNT
      // is what exhausted the Worker. Singular navigation links keep
      // prefetch — the cost there is one request, and the win is real.
      prefetch={false}
      className="block bg-surface rounded-lg p-5 transition-shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <BillCardHeader bill={bill} />
        </div>
        {bill.status && (
          <p className="text-sm text-content-dim whitespace-nowrap shrink-0 max-w-[10rem] text-right line-clamp-2">
            {bill.status}
          </p>
        )}
      </div>

      {bill.lastAction && (
        <div className="mt-3 flex items-baseline gap-2 text-xs text-content-dim">
          <span className="text-content-dim whitespace-nowrap">
            {bill.lastActionDate ? formatDate(bill.lastActionDate) : ""}
          </span>
          <span className="line-clamp-1">{bill.lastAction}</span>
        </div>
      )}
    </Link>
  );
}

type FilterState = {
  measureTypeCode: string;
  sessionYear: string;
};

export default function BillsPage() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    measureTypeCode: "",
    sessionYear: "",
  });
  // Active/Inactive segmented toggle (#747). Default ACTIVE — currently
  // moveable bills. INACTIVE shows chaptered + dead together with per-card
  // Passed/Historical chips so users can still distinguish them.
  const [lifecycle, setLifecycle] = useState<BillLifecycle>(
    BillLifecycle.ACTIVE,
  );

  // Honour deep-links from representative and committee detail pages
  const authorId = searchParams.get("authorId") ?? undefined;
  const committeeId = searchParams.get("committeeId") ?? undefined;

  const { civics } = useCivics();
  const measureTypes = civics?.measureTypes ?? [];

  const variables: BillsVars = {
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
    ...(filters.measureTypeCode && {
      measureTypeCode: filters.measureTypeCode,
    }),
    ...(filters.sessionYear && { sessionYear: filters.sessionYear }),
    ...(authorId && { authorId }),
    ...(committeeId && { committeeId }),
    lifecycle,
  };

  const { data, loading, error } = useQuery<BillsData, BillsVars>(GET_BILLS, {
    variables,
    fetchPolicy: "cache-and-network",
  });

  // Derive session years from loaded bills rather than hardcoding a static list
  const sessionYears = useMemo(() => {
    const years = new Set(data?.bills.items.map((b) => b.sessionYear) ?? []);
    return Array.from(years).sort().reverse();
  }, [data?.bills.items]);

  function setFilter<K extends keyof FilterState>(key: K, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  const filterBar = (
    <div className="flex flex-wrap gap-3 mb-6">
      <select
        value={filters.measureTypeCode}
        onChange={(e) => setFilter("measureTypeCode", e.target.value)}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content-dim focus:outline-none focus:ring-2 focus:ring-accent"
        aria-label="Filter by measure type"
      >
        <option value="">All types</option>
        {measureTypes.map((mt) => (
          <option key={mt.code} value={mt.code}>
            {mt.code} — {mt.name}
          </option>
        ))}
      </select>

      <select
        value={filters.sessionYear}
        onChange={(e) => setFilter("sessionYear", e.target.value)}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content-dim focus:outline-none focus:ring-2 focus:ring-accent"
        aria-label="Filter by session year"
      >
        <option value="">All sessions</option>
        {sessionYears.map((y) => (
          <option key={y} value={y}>
            {y.replace("-", "–")}
          </option>
        ))}
      </select>

      {(filters.measureTypeCode || filters.sessionYear) && (
        <button
          type="button"
          onClick={() => {
            setFilters({ measureTypeCode: "", sessionYear: "" });
            setPage(0);
          }}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content-dim hover:bg-surface-alt"
        >
          Clear filters
        </button>
      )}

      <div
        role="radiogroup"
        aria-label="Bill lifecycle filter"
        className="ml-auto inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm"
      >
        <LifecycleOption
          value={BillLifecycle.ACTIVE}
          label="Active"
          selected={lifecycle === BillLifecycle.ACTIVE}
          onSelect={() => {
            setLifecycle(BillLifecycle.ACTIVE);
            setPage(0);
          }}
        />
        <LifecycleOption
          value={BillLifecycle.INACTIVE}
          label="Inactive"
          selected={lifecycle === BillLifecycle.INACTIVE}
          onSelect={() => {
            setLifecycle(BillLifecycle.INACTIVE);
            setPage(0);
          }}
        />
      </div>
    </div>
  );

  const renderContent = () => {
    if (loading && !data) return <LoadingSkeleton />;
    if (error) return <ErrorState entity="bills" />;
    if (data?.bills.items.length === 0) return <EmptyState entity="bills" />;

    return (
      <>
        <div className="space-y-3">
          {data?.bills.items.map((bill) => (
            <BillCard key={bill.id} bill={bill} />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.bills.total ?? 0}
          hasMore={data?.bills.hasMore ?? false}
          onPageChange={setPage}
        />
      </>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <Breadcrumb
        segments={[{ label: "Region", href: "/region" }, { label: "Bills" }]}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content">Bills</h1>
        <p className="mt-2 text-content-dim">
          Legislative bills moving through your region&apos;s legislature
        </p>
      </div>
      {filterBar}
      {renderContent()}
    </div>
  );
}
