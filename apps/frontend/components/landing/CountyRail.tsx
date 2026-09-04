"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  STATEWIDE_INITIATIVE,
  type CountyThreshold,
} from "@/lib/graphql/counties";

export interface CountyRailProps {
  /** The selected county, or null for the statewide default state. */
  county: CountyThreshold | null;
  /** Selecting the cheapest neighbour moves the map with the rail. */
  onSelectFips?: (fips: string) => void;
  className?: string;
}

/**
 * The figures for one county, or California's own when nothing is selected.
 *
 * Everything the map encodes in colour is repeated here as a number. That is
 * not redundancy — a value carried only by hue is unreadable to anyone with a
 * colour vision deficiency and invisible to a screen reader, so the rail is
 * what makes the map's information actually available (WCAG 1.4.1).
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

  // Locale-aware grouping: 1,234 in English, 1.234 in Spanish. Hardcoding
  // toLocaleString() without a locale silently follows the server's, which is
  // not the reader's.
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
  const df = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }),
    [i18n.language],
  );

  if (!county) {
    return (
      <aside className={className} aria-label={t("counties.statewide.heading")}>
        <h3 className="text-lg font-semibold text-content">
          {t("counties.rail.statewideHeading")}
        </h3>
        <p className="mt-1 text-sm text-content-dim">
          {t("counties.rail.selectPrompt")}
        </p>

        <h4 className="mt-6 text-sm font-medium text-content-dim">
          {t("counties.statewide.heading")}
        </h4>
        <dl className="mt-2 space-y-4">
          <Figure
            label={t("counties.statewide.statute")}
            value={t("counties.statewide.statuteValue", {
              count: nf.format(STATEWIDE_INITIATIVE.statute),
            })}
            hint={t("counties.statewide.statuteBasis")}
          />
          <Figure
            label={t("counties.statewide.amendment")}
            value={t("counties.statewide.amendmentValue", {
              count: nf.format(STATEWIDE_INITIATIVE.constitutionalAmendment),
            })}
            hint={t("counties.statewide.amendmentBasis")}
          />
        </dl>
      </aside>
    );
  }

  const neighbor = county.cheapestNeighbor;

  return (
    <aside className={className} aria-label={county.name}>
      <h3 className="text-lg font-semibold text-content">{county.name}</h3>

      {/* The requirement is the figure the page exists to state, so it is the
          one rendered large — the rest is the context that makes it mean
          something. */}
      <p className="mt-4 text-4xl font-semibold tabular-nums text-accent">
        {nf.format(county.signaturesRequired)}
      </p>
      <p className="text-sm text-content-dim">
        {t("counties.rail.signaturesRequired")}
      </p>
      <p className="text-xs text-content-dim">
        {t("counties.rail.signaturesRequiredHint", {
          year: county.gubernatorialYear,
        })}
      </p>

      <dl className="mt-6 space-y-4">
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
              ? t("counties.rail.unknown")
              : nf.format(county.registeredVoters)
          }
        />
        <Figure
          label={t("counties.rail.shareOfRegistered")}
          value={
            county.shareOfRegistered === null
              ? t("counties.rail.unknown")
              : pf.format(county.shareOfRegistered)
          }
        />
        <Figure
          label={t("counties.rail.population")}
          value={
            county.population === null
              ? t("counties.rail.unknown")
              : nf.format(county.population)
          }
        />
        <Figure
          label={t("counties.rail.rank")}
          value={t("counties.rail.rankValue", { rank: nf.format(county.rank) })}
        />
        {neighbor && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-content-dim">
              {t("counties.rail.cheapestNeighbor")}
            </dt>
            <dd className="mt-1 text-sm text-content">
              {onSelectFips ? (
                <button
                  type="button"
                  onClick={() => onSelectFips(neighbor.fips)}
                  className="underline underline-offset-2 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
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
      <p className="mt-6 text-xs text-content-dim">
        {t("counties.rail.source")}:{" "}
        <Link
          href={county.sourceUrl}
          className="underline underline-offset-2 hover:text-accent"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("counties.rail.sourceLink")}
        </Link>
        {" · "}
        {t("counties.rail.retrieved", {
          date: df.format(new Date(county.retrievedAt)),
        })}
      </p>
    </aside>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-content-dim">
        {label}
      </dt>
      <dd className="mt-1 text-sm tabular-nums text-content">{value}</dd>
      {hint && <dd className="text-xs text-content-dim">{hint}</dd>}
    </div>
  );
}
