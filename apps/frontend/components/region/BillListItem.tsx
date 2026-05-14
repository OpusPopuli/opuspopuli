"use client";

import Link from "next/link";
import type { Bill } from "@/lib/graphql/region";

const MEASURE_TYPE_STYLES: Record<string, string> = {
  AB: "bg-blue-100 text-blue-800",
  SB: "bg-purple-100 text-purple-800",
  ACA: "bg-indigo-100 text-indigo-800",
  SCA: "bg-violet-100 text-violet-800",
};

interface BillListItemProps {
  readonly bill: Bill;
}

interface BillsListProps {
  readonly bills: Bill[];
  readonly totalCount: number;
  readonly viewAllHref: string;
}

/**
 * Renders a list of bills with BillListItem rows and an optional "view all" link.
 * Shared by CommitteeBillsList and AuthoredBillsList.
 */
export function BillsList({ bills, totalCount, viewAllHref }: BillsListProps) {
  return (
    <div className="space-y-2">
      {bills.map((bill) => (
        <BillListItem key={bill.id} bill={bill} />
      ))}
      {totalCount > 10 && (
        <Link
          href={viewAllHref}
          className="block text-center text-sm text-blue-600 hover:underline pt-1"
        >
          View all {totalCount} bills →
        </Link>
      )}
    </div>
  );
}

/**
 * Single row in a bill list, shared by AuthoredBillsList
 * (representatives) and CommitteeBillsList (legislative-committees).
 */
export function BillListItem({ bill }: BillListItemProps) {
  const typeCls =
    MEASURE_TYPE_STYLES[bill.measureTypeCode] ?? "bg-gray-100 text-gray-700";

  return (
    <Link
      href={`/region/bills/${bill.id}`}
      className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white p-3 hover:border-slate-200 hover:shadow-sm transition-all"
    >
      <span
        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${typeCls}`}
      >
        {bill.billNumber}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#222222] line-clamp-1">
          {bill.title}
        </p>
        {bill.status && (
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
            {bill.status}
          </p>
        )}
      </div>
    </Link>
  );
}
