"use client";

import { useState } from "react";

import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MEETINGS,
  GET_REPRESENTATIVES,
  MY_COUNTY_SUPERVISORS,
  type MeetingsData,
  type MyCountySupervisorsData,
  type RepresentativesData,
} from "@/lib/graphql/region";
import {
  GET_COUNTY_THRESHOLDS,
  type CountyThresholdsData,
} from "@/lib/graphql/counties";
import {
  ActivityRow,
  BuildingTag,
  DetailRow,
  IndexRow,
  LayerPageShell,
  LayerSection,
  Ledger,
} from "@/components/region/LayerPageShell";
import { LoadingSkeleton } from "@/components/region/ListStates";
import { useJurisdictions } from "@/components/region/JurisdictionsContext";
import {
  COUNTY_BOARD_CHAMBER,
  COUNTY_MEETING_BODY,
  findByType,
} from "@/lib/region-stack";
import { STATEWIDE_INITIATIVE } from "@/lib/graphql/counties";
import { formatDate } from "@/lib/format";

const RECENT_LIMIT = 5;

/**
 * Wide enough to clear the entire non-county population of the meetings
 * table many times over (13 legislative rows against 507 board ones today),
 * so the five shown are genuinely the five most recent board meetings.
 */
const MEETING_PROBE_SIZE = 100;

/** "Lynda Hopkins" -> "Hopkins". Surnames alone read as a board roster. */
function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

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

  const { jurisdictions, loading } = useJurisdictions();
  const { data: sup } = useQuery<MyCountySupervisorsData>(
    MY_COUNTY_SUPERVISORS,
  );
  const { data: thresholds } = useQuery<CountyThresholdsData>(
    GET_COUNTY_THRESHOLDS,
  );
  // The table mixes county board meetings with legislative ones and has no
  // jurisdiction column (#1139), so the county rows have to be picked out
  // here. The probe is deliberately far wider than the five rows shown:
  // with a narrow window a burst of Assembly meetings — which cluster at
  // the top, 11 of the newest 25 today — pushes every board meeting out and
  // empties this section while hundreds exist. A server-side filter is the
  // real fix and lands with #1139.
  const { data: meetingData } = useQuery<MeetingsData>(GET_MEETINGS, {
    variables: { take: MEETING_PROBE_SIZE },
  });

  // The whole board, not just the reader's seat: myCountySupervisors is
  // district-filtered once a supervisorial boundary resolves (#1136), so it
  // cannot answer "how many seats" or "who are the others".
  const { data: boardData } = useQuery<RepresentativesData>(
    GET_REPRESENTATIVES,
    { variables: { take: 20, chamber: COUNTY_BOARD_CHAMBER } },
  );

  // Captured once per mount: Date.now() in a render path is impure
  // (react-hooks/purity) and would re-split past from upcoming on every
  // re-render. Meeting boundaries are days apart; mount-time is ample.
  const [nowMs] = useState(() => Date.now());

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <LoadingSkeleton count={3} height="h-20" />
      </div>
    );
  }

  const county = findByType(jurisdictions, "COUNTY");
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
  const allMeetings = meetingData?.meetings.items ?? [];
  const boardMeetings = allMeetings.filter(
    (m) => m.body === COUNTY_MEETING_BODY,
  );

  // The feed is scheduledAt-descending, so future meetings sit at the head
  // of it. Rendering those under "what the county did" reported meetings
  // that have not happened as things it had already done.
  const scheduled = (m: { scheduledAt?: string | null }) =>
    m.scheduledAt ? Date.parse(m.scheduledAt) : Number.NaN;

  const nextMeeting = boardMeetings
    .filter((m) => scheduled(m) > nowMs)
    .sort((a, b) => scheduled(a) - scheduled(b))[0];

  const meetings = boardMeetings
    .filter((m) => scheduled(m) <= nowMs)
    .slice(0, RECENT_LIMIT);

  const board = boardData?.representatives.items ?? [];
  const otherSeats = board.filter((r) => r.id !== seat?.id);

  // "None in the records we looked at" is a different claim from "none
  // exist", and only the first is ours to make while the probe is bounded.
  const probeSaturated = allMeetings.length === MEETING_PROBE_SIZE;

  const nf = new Intl.NumberFormat(i18n.language);

  return (
    <LayerPageShell
      level="COUNTY"
      levelLabel={t("stack.levels.county")}
      name={county.jurisdiction.name}
      meta={[
        t("stack.county.board"),
        board.length > 0
          ? t("layer.county.seats", { count: board.length })
          : null,
        nextMeeting?.scheduledAt
          ? t("layer.county.nextMeeting", {
              when: formatDate(nextMeeting.scheduledAt),
            })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      header={
        threshold ? (
          <div className="mt-8">
            <div className="border-l-[3px] border-accent bg-surface-sunk px-6 py-5">
              <p className="font-serif text-5xl leading-none tabular-nums text-content">
                {nf.format(threshold.signaturesRequired)}
              </p>
              <p className="mt-3 font-semibold text-content">
                {t("layer.county.thresholdLead")}
              </p>
              <p className="mt-0.5 text-sm text-content-dim">
                {t("layer.county.threshold")}
              </p>
            </div>
            <p className="mt-3 text-sm text-content-dim">
              {t("layer.county.statewide", {
                statewide: nf.format(STATEWIDE_INITIATIVE.statute),
              })}{" "}
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
        ) : null
      }
    >
      {seat && (
        <LayerSection title={t("layer.county.yourSeatSection")}>
          <DetailRow
            strong
            label={
              <Link
                href={`/region/representatives/${seat.id}`}
                prefetch={false}
                className="underline decoration-line underline-offset-4 hover:decoration-accent"
              >
                {seat.district
                  ? t("stack.county.seatValue", {
                      district: seat.district,
                      name: seat.name,
                    })
                  : seat.name}
              </Link>
            }
            detail={
              <>
                {t("layer.county.resolvedFrom")}{" "}
                <Link href="/settings" className="underline">
                  {t("stack.county.wrongSeat")}
                </Link>
              </>
            }
          />
          {otherSeats.length > 0 && (
            <DetailRow
              label={t("layer.county.otherSeats", {
                count: otherSeats.length,
              })}
              detail={
                <Link
                  href="/region/representatives"
                  className="underline decoration-line underline-offset-4 hover:decoration-accent"
                >
                  {otherSeats.map((r) => lastName(r.name)).join(" · ")} →
                </Link>
              }
            />
          )}
        </LayerSection>
      )}

      <Ledger when={t("layer.when")} what={t("layer.county.whatDid")}>
        {meetings.length === 0 ? (
          <p className="py-5 text-sm text-content-dim">
            {t(
              probeSaturated
                ? "layer.county.noMeetingsInWindow"
                : "layer.county.noMeetings",
            )}
          </p>
        ) : (
          meetings.map((m) => (
            <ActivityRow
              key={m.id}
              what={m.title}
              sub={m.body}
              when={m.scheduledAt ? formatDate(m.scheduledAt) : null}
              href="/region/meetings"
            />
          ))
        )}
      </Ledger>

      <LayerSection title={t("layer.alsoHere")}>
        <IndexRow
          label={t("layer.county.meetings")}
          href="/region/meetings"
          count={t("layer.seeAll")}
        />
        {/* The rows exist — 12 Sonoma measures carry
            propositions.region_plugin_name — but that column is not on the
            GraphQL model and there is no filter arg, so they cannot be
            counted or listed scoped to this county yet. "Building" claimed
            we held nothing, which was false; this says what is actually
            true. Exposing the field is #1202. */}
        <IndexRow
          label={t("layer.county.measures")}
          count={
            <span className="text-content-dim">
              {t("layer.county.measuresPending")}
            </span>
          }
        />
        <IndexRow
          label={t("layer.county.filers")}
          count={<BuildingTag label={t("layer.building")} />}
        />
      </LayerSection>
    </LayerPageShell>
  );
}
