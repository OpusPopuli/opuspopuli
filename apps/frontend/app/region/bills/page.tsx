"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_BILLS,
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
  const cls = MEASURE_TYPE_STYLES[code] ?? "bg-gray-100 text-gray-800";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}
    >
      {code}
    </span>
  );
}

function BillCard({ bill }: Readonly<{ bill: Bill }>) {
  return (
    <Link
      href={`/region/bills/${bill.id}`}
      className="block bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <MeasureTypeBadge code={bill.measureTypeCode} />
            <span className="font-mono text-sm font-semibold text-[#334155]">
              {bill.billNumber}
            </span>
            <span className="text-xs text-slate-400">{bill.sessionYear}</span>
          </div>
          <h3 className="text-base font-semibold text-[#222222] line-clamp-2">
            {bill.title}
          </h3>
          {bill.authorName && (
            <p className="mt-1 text-xs text-[#595959]">
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
        <div className="mt-3 flex items-baseline gap-2 text-xs text-[#4d4d4d]">
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
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#334155] focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#334155] focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-500 hover:bg-gray-50"
        >
          Clear filters
        </button>
      )}
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
        <h1 className="text-3xl font-bold text-[#222222]">Bills</h1>
        <p className="mt-2 text-[#4d4d4d]">
          Legislative bills moving through your region&apos;s legislature
        </p>
      </div>
      {filterBar}
      {renderContent()}
    </div>
  );
}
