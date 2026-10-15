"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { type FundingBasis } from "@/lib/graphql/region";

/**
 * States what a funding total rests on (#991).
 *
 * CAL-ACCESS leaves `EXPN_DATE` or `PAYEE_NAML` blank on 56% of expenditure
 * rows ($11.87B). Those rows used to be rejected outright, so the totals on
 * this site read low with nothing saying so. They are admitted now, which
 * means the money is right and some of it cannot be fully described — and
 * that has to be said where the figure is shown, not in a footnote.
 *
 * Four rules this component exists to enforce:
 *
 * 1. **A total never ships without its basis.** Rendered unconditionally.
 * 2. **Name the quantity, not a mood.** "$9.7M of $78.1M has no reported
 *    spending date" is a disclosure. "Figures may be incomplete" is noise
 *    that no reader can act on.
 * 3. **Separate "we hold it but cannot describe it" from "we do not hold
 *    it".** Undated and unattributed money IS in the spent total. Unitemized
 *    money is NOT in the raised total — it was never filed in detail.
 * 4. **Never claim more than was measured.** Each dimension speaks only for
 *    itself, and nothing here asserts the SOURCE was complete — only what is
 *    true of the records on file. Three distinct zeros mean three distinct
 *    things, and each has its own sentence:
 *
 *    | zero | means |
 *    |---|---|
 *    | `measured: false` | nobody computed anything |
 *    | `undatedAmount: 0` with `measured` | no stored row lacks a date |
 *    | `unitemizedAmount: 0`, `reconciledFilings: 0` | never checked |
 *
 * `undatedAmount` and `unattributedAmount` can describe the same expenditure,
 * so they are never added together and the note says why.
 */
export function FundingBasisNote({
  basis,
  totalRaised,
  totalSpent,
  unitemizedBase,
  className = "",
}: {
  readonly basis?: FundingBasis | null;
  readonly totalRaised: number;
  readonly totalSpent: number;
  /**
   * Denominator for the unitemized share — the total the committees REPORTED
   * raising. Omit when no sound denominator exists and the share is dropped
   * rather than computed against a mixed population; see the call in
   * `PropositionFundingSection`.
   */
  readonly unitemizedBase?: number;
  readonly className?: string;
}) {
  const { t, i18n } = useTranslation("civics");
  const lang = i18n.language || "en-US";
  const usd = useMemo<Intl.NumberFormat>(
    () =>
      new Intl.NumberFormat(lang, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }),
    [lang],
  );

  // Two ways the basis can be absent rather than empty, and both must say so
  // rather than render as an all-clear:
  //
  // - Apollo persists responses to IndexedDB, so a reader can arrive with a
  //   funding object cached before this field existed.
  // - `measured: false` means the backend returned the zero fallback without
  //   computing anything — its service is injected @Optional(), so an unwired
  //   provider fails silently, with no throw and no log.
  //
  // Crashing would be worse than a stale total, and showing the total bare
  // would break rule 1. So: say the basis is unknown, and why.
  if (!basis || basis.measured === false) {
    return (
      <Note
        label={t("fundingBasis.label")}
        lines={[t("fundingBasis.unavailable")]}
        className={className}
      />
    );
  }

  const lines = [
    ...spendingLines(basis, totalSpent, t, usd, lang),
    ...contributionLines(basis, unitemizedBase ?? totalRaised, t, usd, lang, {
      hasBase: unitemizedBase !== undefined || totalRaised > 0,
    }),
    // What the total counts, not only what is missing from it (#1367).
    // Published figures dropped 34% platform-wide when memo and
    // sub-itemization schedules stopped being summed, so the basis of the
    // number belongs beside it rather than in a changelog.
    t("fundingBasis.spendBasis"),
    t("fundingBasis.scope"),
    basis.asOfSource
      ? t("fundingBasis.source", { date: formatSourceDate(basis.asOfSource) })
      : t("fundingBasis.sourceUnknown"),
  ];

  return (
    <Note label={t("fundingBasis.label")} lines={lines} className={className} />
  );
}

/** What is unknown about money that IS inside `totalSpent`. */
function spendingLines(
  basis: FundingBasis,
  totalSpent: number,
  t: TFunction,
  usd: Intl.NumberFormat,
  lang: string,
): string[] {
  const lines: string[] = [];

  if (basis.undatedAmount > 0) {
    lines.push(
      t("fundingBasis.undated", {
        amount: usd.format(basis.undatedAmount),
        total: usd.format(totalSpent),
        share: shareSuffix(basis.undatedAmount, totalSpent),
        count: basis.undatedCount,
        // `count` selects the plural form; it interpolates ungrouped, which
        // at real scale reads "5232951 payments". `formatted` is what shows.
        formatted: basis.undatedCount.toLocaleString(lang),
      }),
    );
  }

  if (basis.unattributedAmount > 0) {
    lines.push(
      t("fundingBasis.unattributed", {
        amount: usd.format(basis.unattributedAmount),
        total: usd.format(totalSpent),
        share: shareSuffix(basis.unattributedAmount, totalSpent),
        count: basis.unattributedCount,
        formatted: basis.unattributedCount.toLocaleString(lang),
      }),
    );
  }

  // Only meaningful once both are present; alone, neither can be mistaken
  // for a figure that adds to something.
  if (lines.length === 2) lines.push(t("fundingBasis.doNotAdd"));

  if (lines.length === 0) lines.push(t("fundingBasis.expendituresComplete"));
  return lines;
}

/**
 * What is unknown about money that is NOT inside `totalRaised`.
 *
 * `unitemizedAmount: 0` is ambiguous on its own — it is both "every filing
 * was reconciled and none hid money" and "no filing was ever reconciled".
 * `reconciledFilings` is what separates them, and a missing count (an older
 * cached response) is treated as the unknown case rather than the good one.
 */
function contributionLines(
  basis: FundingBasis,
  base: number,
  t: TFunction,
  usd: Intl.NumberFormat,
  lang: string,
  { hasBase }: { hasBase: boolean },
): string[] {
  if (basis.unitemizedAmount > 0) {
    const amount = usd.format(basis.unitemizedAmount);
    // The denominator is everything the committees REPORTED raising — what we
    // hold plus what was never itemized. Dividing by the stored total alone
    // would overstate our own coverage.
    const total = base + basis.unitemizedAmount;
    return hasBase
      ? [
          t("fundingBasis.unitemized", {
            amount,
            total: usd.format(total),
            share: shareSuffix(basis.unitemizedAmount, total),
          }),
        ]
      : [t("fundingBasis.unitemizedNoBase", { amount })];
  }

  const reconciled = basis.reconciledFilings ?? 0;
  if (reconciled <= 0) return [t("fundingBasis.unreconciled")];

  return [
    t("fundingBasis.contributionsComplete", {
      count: reconciled,
      formatted: reconciled.toLocaleString(lang),
    }),
  ];
}

function Note({
  label,
  lines,
  className = "",
}: {
  readonly label: string;
  readonly lines: string[];
  readonly className?: string;
}) {
  return (
    // role="note", matching FinanceDisclaimer: an annotation on the figures
    // above, not a landmark nested inside the panel's section.
    <div
      role="note"
      aria-label={label}
      className={`rounded-lg bg-surface-alt p-3 text-xs leading-relaxed text-content-dim ${className}`}
    >
      <p className="font-bold uppercase tracking-wider text-[11px] text-content-dim">
        {label}
      </p>
      <ul className="mt-1.5 space-y-1">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The amount's share of its total as a parenthetical, to one decimal place.
 *
 * Carries its own parentheses so a dropped share leaves the sentence intact.
 */
function shareSuffix(amount: number, total: number): string {
  // NOT `total <= 0`, which Sonar's no-inverted-boolean-check suggests and
  // which would be a bug: `NaN <= 0` is false, so a NaN total would fall
  // through to the division and print "(NaN%)". Spelled out explicitly rather
  // than relying on `!(total > 0)` to carry that meaning silently. A share of
  // nothing is not a share, and an invented "(100%)" is worse than silence.
  if (!Number.isFinite(total) || total <= 0) return "";
  // `amount > total` is reachable: `Expenditure.amount` is a SIGNED decimal
  // and CAL-ACCESS files negative rows for refunds and corrections, so dated
  // rows summing below zero can leave an undated subtotal larger than the
  // whole. "(1000.0%)" would be arithmetically faithful and useless; the
  // dollar figures beside it remain exact.
  if (amount > total) return "";
  return ` (${((amount / total) * 100).toFixed(1)}%)`;
}

/**
 * The source export's `last-modified`, rendered as the UTC calendar date.
 *
 * NOT the shared `formatDate`: that converts a genuine instant into the
 * viewer's zone, which is right for a meeting time and wrong here. A
 * `last-modified` of `Mon, 12 Oct 2026 02:00:00 GMT` would render as
 * "Oct 11, 2026" for every US reader — the wrong snapshot date on a
 * provenance claim, which is the one claim that has to be exact.
 */
function formatSourceDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
