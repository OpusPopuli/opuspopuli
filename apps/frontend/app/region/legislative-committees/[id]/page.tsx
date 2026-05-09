"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import {
  GET_LEGISLATIVE_COMMITTEE,
  IdVars,
  LegislativeCommitteeData,
  type LegislativeCommitteeDetail,
  type LegislativeCommitteeMember,
  type LegislativeCommitteeHearing,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { LoadingSkeleton, ErrorState } from "@/components/region/ListStates";
import { SectionTitle } from "@/components/region/SectionTitle";
import { ComingSoon } from "@/components/region/ComingSoon";
import { LayerButton } from "@/components/region/LayerButton";
import { LayerNav } from "@/components/region/LayerNav";
import { PartyBadge } from "@/components/region/PartyBadge";
import { CommitteeActivityStats } from "@/components/region/CommitteeActivityStats";
import { CommitteeActivityFeed } from "@/components/region/CommitteeActivityFeed";
import { ActivitySummary } from "@/components/region/ActivitySummary";
import { CivicTerm } from "@/components/civics/CivicTerm";
import { formatDate } from "@/lib/format";

const LAYERS = [
  { n: 1, label: "Snapshot" },
  { n: 2, label: "Members" },
  { n: 3, label: "Hearings" },
  { n: 4, label: "Deep Dive" },
] as const;

const ROLE_GROUPS: ReadonlyArray<{
  heading: string;
  match: (r?: string) => boolean;
}> = [
  { heading: "Chair", match: (r) => r === "Chair" },
  { heading: "Vice Chair", match: (r) => r === "Vice Chair" },
  {
    heading: "Members",
    match: (r) => !r || (r !== "Chair" && r !== "Vice Chair"),
  },
];

function ChamberBadge({ chamber }: { readonly chamber: string }) {
  const isAssembly = chamber === "Assembly";
  const cls = isAssembly
    ? "bg-blue-100 text-blue-800"
    : "bg-purple-100 text-purple-800";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {chamber}
    </span>
  );
}

function MemberRow({
  member,
}: {
  readonly member: LegislativeCommitteeMember;
}) {
  return (
    <Link
      href={`/region/representatives/${member.representativeId}`}
      className="flex items-center gap-4 p-4 bg-white rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      {member.photoUrl ? (
        <Image
          src={member.photoUrl}
          alt=""
          width={48}
          height={48}
          className="w-12 h-12 rounded-full object-cover bg-slate-100"
          unoptimized
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-slate-100" aria-hidden />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[#222222] truncate">{member.name}</p>
        {member.role && member.role !== "Member" && (
          <p className="text-xs text-[#595959]">{member.role}</p>
        )}
      </div>
      <PartyBadge party={member.party} />
    </Link>
  );
}

function Snapshot({
  committee,
  onNext,
}: {
  readonly committee: LegislativeCommitteeDetail;
  readonly onNext: () => void;
}) {
  const chair = committee.members.find((m) => m.role === "Chair");

  return (
    <div className="animate-layer-enter">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#595959] mb-1">
            Members
          </p>
          <p className="text-2xl font-semibold text-[#222222]">
            {committee.memberCount}
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#595959] mb-1">
            Chamber
          </p>
          <p className="text-2xl font-semibold text-[#222222]">
            {committee.chamber}
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#595959] mb-1">
            Chair
          </p>
          <p className="text-base font-semibold text-[#222222] truncate">
            {chair ? (
              chair.name
            ) : (
              <span className="italic text-slate-400">Vacant</span>
            )}
          </p>
        </div>
      </div>

      <SectionTitle>What this committee does</SectionTitle>
      {committee.description ? (
        <p className="text-[#334155] leading-relaxed mb-6">
          {committee.description}
        </p>
      ) : (
        <ComingSoon
          title="Description coming soon"
          description="A plain-language description of this committee's jurisdiction is on the way. For now, see the members tab to understand its composition."
        />
      )}

      <LayerButton onClick={onNext}>See members</LayerButton>
    </div>
  );
}

function Members({
  committee,
  onNext,
  onBack,
}: {
  readonly committee: LegislativeCommitteeDetail;
  readonly onNext: () => void;
  readonly onBack: () => void;
}) {
  const groups = ROLE_GROUPS.map((g) => ({
    heading: g.heading,
    members: committee.members.filter((m) => g.match(m.role ?? undefined)),
  })).filter((g) => g.members.length > 0);

  return (
    <div className="animate-layer-enter">
      {groups.length === 0 && (
        <p className="italic text-slate-400 mb-6">
          No member assignments are linked to this committee yet.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.heading} className="mb-8">
          <SectionTitle>{g.heading}</SectionTitle>
          <div className="space-y-2">
            {g.members.map((m) => (
              <MemberRow key={m.representativeId} member={m} />
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <LayerButton onClick={onNext}>See hearings</LayerButton>
        <LayerButton onClick={onBack} variant="secondary">
          Back to snapshot
        </LayerButton>
      </div>
    </div>
  );
}

function HearingRow({
  hearing,
}: {
  readonly hearing: LegislativeCommitteeHearing;
}) {
  return (
    <li className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#222222]">{hearing.title}</p>
          <p className="mt-1 text-sm text-[#4d4d4d]">
            {formatDate(hearing.scheduledAt)}
          </p>
        </div>
        {hearing.agendaUrl && (
          <a
            href={hearing.agendaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
          >
            Agenda →
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * Layer 3 — Activity. Live feed of committee_hearing /
 * committee_report / amendment LegislativeActions extracted from
 * the committee's recent minutes. Replaces the previous best-effort
 * title-match against scheduled meetings (which only ever surfaced
 * upcoming meetings, not past activity). Issue #665.
 *
 * The legacy `committee.hearings` field (scheduled meetings list) is
 * still rendered as a small "Upcoming meetings" section for
 * forward-looking context.
 */
function Hearings({
  committee,
  onNext,
  onBack,
  onSeePassage,
}: {
  readonly committee: LegislativeCommitteeDetail;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onSeePassage?: (actionId: string) => void;
}) {
  return (
    <div className="animate-layer-enter">
      <ActivitySummary
        summary={committee.activitySummary}
        generatedAt={committee.activitySummaryGeneratedAt}
        windowDays={committee.activitySummaryWindowDays}
      />

      <CommitteeActivityStats committeeId={committee.id} />

      <div className="mb-8">
        <SectionTitle>Recent activity</SectionTitle>
        <CommitteeActivityFeed
          committeeId={committee.id}
          onSeePassage={onSeePassage}
        />
      </div>

      {committee.hearings.length > 0 && (
        <div className="mb-8">
          <SectionTitle>Upcoming scheduled meetings</SectionTitle>
          <p className="text-sm text-[#4d4d4d] mb-3">
            Best-effort match against the chamber&apos;s daily file for
            forward-looking context.
          </p>
          <ul className="space-y-2">
            {committee.hearings.map((h) => (
              <HearingRow key={h.id} hearing={h} />
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <LayerButton onClick={onNext}>Sources & deep dive</LayerButton>
        <LayerButton onClick={onBack} variant="secondary">
          Back to members
        </LayerButton>
      </div>
    </div>
  );
}

function DeepDive({
  committee,
  onBack,
}: {
  readonly committee: LegislativeCommitteeDetail;
  readonly onBack: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <SectionTitle>Sources</SectionTitle>
      <dl className="bg-slate-50 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="font-bold uppercase tracking-wider text-xs text-[#595959]">
            External ID
          </dt>
          <dd className="font-mono text-[#334155] break-all">
            {committee.externalId}
          </dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-wider text-xs text-[#595959]">
            Last updated
          </dt>
          <dd className="text-[#334155]">{formatDate(committee.updatedAt)}</dd>
        </div>
        {committee.url && (
          <div className="sm:col-span-2">
            <dt className="font-bold uppercase tracking-wider text-xs text-[#595959]">
              Official link
            </dt>
            <dd>
              <a
                href={committee.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 hover:underline break-all"
              >
                {committee.url}
              </a>
            </dd>
          </div>
        )}
      </dl>

      <SectionTitle>Coming soon</SectionTitle>
      <ComingSoon
        title="Deeper context"
        description="Jurisdiction, bill referrals, and staff contacts will appear here once dedicated committee scraping ships."
      />

      <div className="mt-6">
        <LayerButton onClick={onBack} variant="secondary">
          Back to hearings
        </LayerButton>
      </div>
    </div>
  );
}

export default function LegislativeCommitteeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [layer, setLayer] = useState(1);

  const { data, loading, error } = useQuery<LegislativeCommitteeData, IdVars>(
    GET_LEGISLATIVE_COMMITTEE,
    { variables: { id } },
  );

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <LoadingSkeleton count={1} height="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <ErrorState entity="legislative committee" />
      </div>
    );
  }

  const committee = data?.legislativeCommittee;

  if (!committee) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#4d4d4d] mb-4">Committee not found.</p>
          <Link
            href="/region/legislative-committees"
            className="text-blue-600 hover:text-blue-700 hover:underline text-sm font-medium"
          >
            Back to legislative committees
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <Breadcrumb
        segments={[
          { label: "Region", href: "/region" },
          {
            label: "Legislative Committees",
            href: "/region/legislative-committees",
          },
          { label: committee.name },
        ]}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#222222] leading-tight mb-3">
          {committee.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <ChamberBadge chamber={committee.chamber} />
          <span className="text-sm text-[#4d4d4d]">
            <CivicTerm term="committee">Committee</CivicTerm>
            {" · "}
            {committee.memberCount}{" "}
            {committee.memberCount === 1 ? "member" : "members"}
          </span>
        </div>
      </div>

      <LayerNav layers={LAYERS} current={layer} onChange={setLayer} />

      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        {layer === 1 && (
          <Snapshot committee={committee} onNext={() => setLayer(2)} />
        )}
        {layer === 2 && (
          <Members
            committee={committee}
            onNext={() => setLayer(3)}
            onBack={() => setLayer(1)}
          />
        )}
        {layer === 3 && (
          <Hearings
            committee={committee}
            onNext={() => setLayer(4)}
            onBack={() => setLayer(2)}
          />
        )}
        {layer === 4 && (
          <DeepDive committee={committee} onBack={() => setLayer(3)} />
        )}
      </div>
    </div>
  );
}
