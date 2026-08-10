"use client";

import Link from "next/link";
import type { Bill } from "@/lib/graphql/region";

// Measure type is a category, not a status. Each of the four gets its own
// categorical hue so they stay distinguishable at badge size.
const MEASURE_TYPE_STYLES: Record<string, string> = {
  AB: "bg-cat-blue-surface text-cat-blue",
  SB: "bg-cat-purple-surface text-cat-purple",
  ACA: "bg-cat-teal-surface text-cat-teal",
  SCA: "bg-cat-amber-surface text-cat-amber",
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
          className="block text-center text-sm text-info hover:underline pt-1"
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
    MEASURE_TYPE_STYLES[bill.measureTypeCode] ?? "bg-surface-alt text-content";

  return (
    <Link
      href={`/region/bills/${bill.id}`}
      className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3 hover:border-accent transition-all"
    >
      <span
        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${typeCls}`}
      >
        {bill.billNumber}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-content line-clamp-1">
          {bill.title}
        </p>
        {bill.status && (
          <p className="text-sm text-content-dim mt-0.5 line-clamp-1">
            {bill.status}
          </p>
        )}
      </div>
    </Link>
  );
}
