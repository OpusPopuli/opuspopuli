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
import { useCivics } from "@/components/civics/CivicsContext";
import { formatDate } from "@/lib/format";
import { MEASURE_TYPE_STYLES } from "@/lib/bill-styles";

const PAGE_SIZE = 20;

function MeasureTypeBadge({ code }: { readonly code: string }) {
  const cls = MEASURE_TYPE_STYLES[code] ?? "bg-surface-alt text-content";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}
    >
      {code}
    </span>
  );
}

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
      className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-sage-dark)] ${
        selected
          ? "bg-[var(--color-sage-dark)] text-white"
          : "text-content-dim hover:bg-surface-alt"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Per-card lifecycle pill. Active bills get no chip (cleaner default);
 * chaptered (passed-into-law) bills get a Passed chip; dead bills get a
 * Historical chip. Maps the isActive + isDead 3-way partition to a visual.
 */
function LifecycleChip({ bill }: { readonly bill: Bill }) {
  if (bill.isActive) return null;
  if (bill.isDead) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        Historical
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-800">
      Passed
    </span>
  );
}

function BillCard({ bill }: Readonly<{ bill: Bill }>) {
  return (
    <Link
      href={`/region/bills/${bill.id}`}
      className="block bg-surface rounded-lg p-5 transition-shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <MeasureTypeBadge code={bill.measureTypeCode} />
            <span className="font-mono text-sm font-semibold text-content-dim">
              {bill.billNumber}
            </span>
            <span className="text-xs text-slate-400">{bill.sessionYear}</span>
            <LifecycleChip bill={bill} />
          </div>
          <h3 className="text-base font-semibold text-content line-clamp-2">
            {bill.title}
          </h3>
          {bill.authorName && (
            <p className="mt-1 text-xs text-content-dim">
              Author: {bill.authorName}
            </p>
          )}
        </div>
        {bill.status && (
          <p className="text-xs text-slate-500 whitespace-nowrap shrink-0 max-w-[10rem] text-right line-clamp-2">
            {bill.status}
          </p>
        )}
      </div>

      {bill.lastAction && (
        <div className="mt-3 flex items-baseline gap-2 text-xs text-content-dim">
          <span className="text-slate-400 whitespace-nowrap">
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
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content-dim focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content-dim focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-slate-500 hover:bg-surface-alt"
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
