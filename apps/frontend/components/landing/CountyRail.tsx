"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CountyThreshold } from "@/lib/graphql/counties";

export interface CountyRailProps {
  county: CountyThreshold;
  /** Selecting the cheapest neighbour moves the map with the panel. */
  onSelectFips?: (fips: string) => void;
  className?: string;
}

/**
 * The figures for one county, as a ledger.
 *
 * Everything the map encodes in colour is repeated here as a number. That is
 * not redundancy: a value carried only by hue is unreadable to anyone with a
 * colour vision deficiency and invisible to a screen reader, so this is what
 * makes the map's information actually available (WCAG 1.4.1).
 *
 * Public records only. Nothing on this route touches user, signup or
 * activation data (#1105 criterion 9).
 */
export function CountyRail({
  county,
  onSelectFips,
  className,
}: CountyRailProps) {
  const { t, i18n } = useTranslation("landing");

  // Locale-aware grouping: 1,234 in English, 1.234 in Spanish. A bare
  // toLocaleString() follows the server's locale, which is not the reader's.
  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );
  const pf = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: "percent",
        maximumFractionDigits: 2,
      }),
    [i18n.language],
  );

  const unknown = t("counties.rail.unknown");
  const neighbor = county.cheapestNeighbor;

  return (
    <aside className={className} aria-label={county.name}>
      <h2 className="font-serif text-3xl leading-tight text-content">
        {county.name}
      </h2>
      <p className="mt-1 text-xs uppercase tracking-wide text-content-dim">
        {t("counties.rail.rankValue", { rank: nf.format(county.rank) })}
      </p>

      {/* The requirement is the figure the page exists to state, so it is the
          one rendered large. The rest is the context that makes it mean
          something.

          Ink, not gold. Gold text on paper is ~2.2:1 and fails both the brand
          rule in globals.css and WCAG 1.4.3 even at this size, so the gold is
          spent on the 3px rule above instead, where it is an earned accent. */}
      <div aria-hidden="true" className="mt-6 h-[3px] w-12 bg-accent" />
      <p className="mt-3 font-serif text-6xl leading-none tabular-nums text-content">
        {nf.format(county.signaturesRequired)}
      </p>
      <p className="mt-1 text-sm text-content-dim">
        {t("counties.rail.signaturesRequired")}
      </p>

      <dl className="mt-6">
        <Figure
          label={t("counties.rail.gubernatorialVotes", {
            year: county.gubernatorialYear,
          })}
          value={nf.format(county.gubernatorialVotes)}
        />
        <Figure
          label={t("counties.rail.registeredVoters")}
          value={
            county.registeredVoters === null
              ? unknown
              : nf.format(county.registeredVoters)
          }
        />
        <Figure
          label={t("counties.rail.shareOfRegistered")}
          value={
            county.shareOfRegistered === null
              ? unknown
              : pf.format(county.shareOfRegistered)
          }
        />
        <Figure
          label={t("counties.rail.population")}
          value={
            county.population === null ? unknown : nf.format(county.population)
          }
        />
        {neighbor && (
          <div className="flex items-baseline justify-between gap-4 border-t border-line py-2">
            <dt className="text-sm text-content-dim">
              {t("counties.rail.cheapestNeighbor")}
            </dt>
            <dd className="text-right text-sm text-content">
              {onSelectFips ? (
                <button
                  type="button"
                  onClick={() => onSelectFips(neighbor.fips)}
                  className="underline decoration-line underline-offset-2 transition-colors hover:decoration-accent"
                >
                  {t("counties.rail.cheapestNeighborValue", {
                    name: neighbor.name,
                    count: nf.format(neighbor.signaturesRequired),
                  })}
                </button>
              ) : (
                t("counties.rail.cheapestNeighborValue", {
                  name: neighbor.name,
                  count: nf.format(neighbor.signaturesRequired),
                })
              )}
            </dd>
          </div>
        )}
      </dl>

      {/* Provenance is part of the contract, not a footnote: the page asks the
          reader to trust a number, so it shows them where to check it. */}
      <p className="mt-5 text-xs leading-relaxed text-content-dim">
        <a href={county.sourceUrl} target="_blank" rel="noopener noreferrer">
          {t("counties.rail.sources")}
        </a>
      </p>
    </aside>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2">
      <dt className="text-sm text-content-dim">{label}</dt>
      <dd className="text-right text-sm tabular-nums text-content">{value}</dd>
    </div>
  );
}
