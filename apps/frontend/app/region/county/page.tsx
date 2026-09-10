"use client";

import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MEETINGS,
  MY_COUNTY_SUPERVISORS,
  MY_JURISDICTIONS,
  type MeetingsData,
  type MyCountySupervisorsData,
  type MyJurisdictionsData,
} from "@/lib/graphql/region";
import {
  GET_COUNTY_THRESHOLDS,
  type CountyThresholdsData,
} from "@/lib/graphql/counties";
import {
  ActivityRow,
  BuildingTag,
  IndexRow,
  LayerPageShell,
  LayerSection,
} from "@/components/region/LayerPageShell";
import { LoadingSkeleton } from "@/components/region/ListStates";
import { COUNTY_MEETING_BODY, findByType } from "@/lib/region-stack";
import { formatDate } from "@/lib/format";

const RECENT_LIMIT = 5;

/**
 * The county layer page (#1195).
 *
 * Two parts, like every layer page: who governs here, then what's here.
 *
 * The §9118 threshold appears exactly once, in the header, as a cited fact —
 * not as a per-row "what it would take" column, which was cut from this epic
 * on 2026-09-09. Do not reintroduce it here without revisiting that.
 */
export default function CountyLayerPage() {
  const { t, i18n } = useTranslation("region");

  const { data: jur, loading } =
    useQuery<MyJurisdictionsData>(MY_JURISDICTIONS);
  const { data: sup } = useQuery<MyCountySupervisorsData>(
    MY_COUNTY_SUPERVISORS,
  );
  const { data: thresholds } = useQuery<CountyThresholdsData>(
    GET_COUNTY_THRESHOLDS,
  );
  const { data: meetingData } = useQuery<MeetingsData>(GET_MEETINGS, {
    variables: { take: 25 },
  });

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={3} height="h-20" />
      </div>
    );
  }

  const county = findByType(jur?.myJurisdictions ?? [], "COUNTY");
  if (!county) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <p className="font-semibold text-content">
          {t("stack.noAddress.title")}
        </p>
        <p className="mt-1 text-sm text-content-dim">
          {t("stack.noAddress.body")}
        </p>
      </div>
    );
  }

  const supervisors = sup?.myCountySupervisors ?? [];
  const seat = supervisors.length === 1 ? supervisors[0] : null;

  // Matched on FIPS, never on name: two answers to "what is 06097 called"
  // is exactly the drift #1105 refused to introduce.
  const threshold = thresholds?.countyThresholds.find(
    (c) => c.fips === county.jurisdiction.fipsCode,
  );

  // `meetings` has no jurisdiction filter (#1139), so county activity is
  // separated by its own `body` rather than assumed. State meetings sit in
  // the same table and would otherwise render here as county business.
  const meetings = (meetingData?.meetings.items ?? [])
    .filter((m) => m.body === COUNTY_MEETING_BODY)
    .slice(0, RECENT_LIMIT);

  const nf = new Intl.NumberFormat(i18n.language);

  return (
    <LayerPageShell
      levelLabel={t("stack.levels.county")}
      gold
      name={county.jurisdiction.name}
      meta={t("stack.county.board")}
      header={
        <div className="mt-6 space-y-4">
          {seat && (
            <div className="rounded-md bg-surface-sunk px-4 py-3 text-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-content-dim">
                {t("stack.county.yourSeat")}
              </span>{" "}
              <Link
                href={`/region/representatives/${seat.id}`}
                prefetch={false}
                className="font-semibold text-content underline decoration-line underline-offset-2 hover:decoration-accent"
              >
                {seat.district
                  ? t("stack.county.seatValue", {
                      district: seat.district,
                      name: seat.name,
                    })
                  : seat.name}
              </Link>
            </div>
          )}
          {threshold && (
            <div className="border-l-[3px] border-accent bg-surface-sunk px-4 py-3">
              <p className="font-serif text-2xl tabular-nums text-content">
                {nf.format(threshold.signaturesRequired)}
              </p>
              <p className="mt-1 text-sm text-content-dim">
                {t("layer.county.threshold")}{" "}
                <a
                  href={threshold.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {t("layer.county.thresholdSource", {
                    year: threshold.gubernatorialYear,
                  })}
                </a>
              </p>
            </div>
          )}
        </div>
      }
    >
      <LayerSection title={t("layer.recent")}>
        {meetings.length === 0 ? (
          <p className="py-4 text-sm text-content-dim">
            {t("layer.county.noMeetings")}
          </p>
        ) : (
          meetings.map((m) => (
            <ActivityRow
              key={m.id}
              badge={t("stack.levels.county")}
              what={m.title}
              sub={m.body}
              when={m.scheduledAt ? formatDate(m.scheduledAt) : null}
              href="/region/meetings"
            />
          ))
        )}
      </LayerSection>

      <LayerSection title={t("layer.alsoHere")}>
        <IndexRow
          label={t("layer.county.meetings")}
          href="/region/meetings"
          count={t("layer.seeAll")}
        />
        <IndexRow
          label={t("layer.county.measures")}
          count={<BuildingTag label={t("layer.building")} />}
        />
        <IndexRow
          label={t("layer.county.filers")}
          count={<BuildingTag label={t("layer.building")} />}
        />
      </LayerSection>
    </LayerPageShell>
  );
}
