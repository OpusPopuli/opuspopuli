"use client";

import { useTranslation } from "react-i18next";
import { MEASURE_TYPE_STYLES } from "@/lib/bill-styles";

/**
 * The identity block of a bill card: measure-type chip, number, session,
 * lifecycle chip, title, author.
 *
 * Extracted so the bills list (`/region/bills`) and the search results
 * page (`/region/search`) render a bill identically — they had drifted
 * into a copy, which the CPD gate caught (#1154). Each caller keeps its
 * own outer wrapper (flat vs bordered, status column, snippet), because
 * that is where they legitimately differ.
 */

/** Structural minimum both `Bill` and `SearchBillResult` satisfy. */
export interface BillCardHeaderBill {
  readonly measureTypeCode: string;
  readonly billNumber: string;
  readonly sessionYear: string;
  readonly title: string;
  readonly authorName?: string | null;
  readonly isActive: boolean;
  readonly isDead: boolean;
}

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
 * Per-card lifecycle pill. Active bills get no chip (cleaner default);
 * chaptered (passed-into-law) bills get a Passed chip; dead bills get a
 * Historical chip. Maps the isActive + isDead 3-way partition to a visual.
 */
function LifecycleChip({ bill }: { readonly bill: BillCardHeaderBill }) {
  const { t } = useTranslation("region");
  if (bill.isActive) return null;
  if (bill.isDead) {
    return (
      <span className="inline-flex items-center rounded-full bg-warning-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
        {t("lifecycle.historical")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-positive-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-positive">
      {t("lifecycle.passed")}
    </span>
  );
}

export function BillCardHeader({
  bill,
}: {
  readonly bill: BillCardHeaderBill;
}) {
  const { t } = useTranslation("region");
  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <MeasureTypeBadge code={bill.measureTypeCode} />
        <span className="font-mono text-sm font-semibold text-content-dim">
          {bill.billNumber}
        </span>
        <span className="text-xs text-content-dim">{bill.sessionYear}</span>
        <LifecycleChip bill={bill} />
      </div>
      <h3 className="text-base font-semibold text-content line-clamp-2">
        {bill.title}
      </h3>
      {bill.authorName && (
        <p className="mt-1 text-sm text-content-dim">
          {t("search.authorLabel", { name: bill.authorName })}
        </p>
      )}
    </>
  );
}
