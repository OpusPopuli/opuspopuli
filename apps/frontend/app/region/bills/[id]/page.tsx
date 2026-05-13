"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import type { CivicsLifecycleStage } from "@/lib/graphql/region";
import {
  GET_BILL,
  type BillData,
  type BillIdVars,
  type BillVote,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { LoadingSkeleton, ErrorState } from "@/components/region/ListStates";
import { SectionTitle } from "@/components/region/SectionTitle";
import { LayerButton } from "@/components/region/LayerButton";
import { LayerNav } from "@/components/region/LayerNav";
import { ComingSoon } from "@/components/region/ComingSoon";
import { LifecycleProgressBar } from "@/components/civics/LifecycleProgressBar";
import { useCivics } from "@/components/civics/CivicsContext";
import { formatDate } from "@/lib/format";
import { MEASURE_TYPE_STYLES } from "@/lib/bill-styles";
import { useState, useMemo } from "react";

const LAYERS = [
  { n: 1, label: "Snapshot" },
  { n: 2, label: "Votes" },
  { n: 3, label: "Sources" },
] as const;

const POSITION_STYLES: Record<string, { cls: string; label: string }> = {
  yes: { cls: "bg-green-100 text-green-800", label: "Yes" },
  no: { cls: "bg-red-100 text-red-800", label: "No" },
  abstain: { cls: "bg-yellow-100 text-yellow-800", label: "Abstain" },
  absent: { cls: "bg-gray-100 text-gray-600", label: "Absent" },
  excused: { cls: "bg-blue-100 text-blue-700", label: "Excused" },
  no_vote: { cls: "bg-gray-100 text-gray-400", label: "—" },
};

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

function PositionBadge({ position }: { readonly position: string }) {
  const style = POSITION_STYLES[position] ?? POSITION_STYLES.no_vote;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${style.cls}`}
    >
      {style.label}
    </span>
  );
}

function VoteSummaryBar({ votes }: { readonly votes: BillVote[] }) {
  const counts = votes.reduce<Record<string, number>>((acc, v) => {
    acc[v.position] = (acc[v.position] ?? 0) + 1;
    return acc;
  }, {});

  const order: Array<keyof typeof POSITION_STYLES> = [
    "yes",
    "no",
    "abstain",
    "absent",
    "excused",
    "no_vote",
  ];

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {order.map((pos) =>
        counts[pos] ? (
          <div key={pos} className="flex items-center gap-1.5 text-sm">
            <PositionBadge position={pos} />
            <span className="font-semibold text-[#222222]">{counts[pos]}</span>
          </div>
        ) : null,
      )}
    </div>
  );
}

// ── Layer components ──────────────────────────────────────────────────────────

function Snapshot({
  bill,
  lifecycleStages,
  onNext,
}: {
  readonly bill: NonNullable<BillData["bill"]>;
  readonly lifecycleStages: CivicsLifecycleStage[];
  readonly onNext: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      {/* Status + last action */}
      {bill.status && (
        <div className="mb-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-[#334155]">
          <span className="font-semibold">Status:</span> {bill.status}
        </div>
      )}

      {/* Lifecycle bar */}
      {lifecycleStages.length > 0 && (
        <div className="mb-6">
          <SectionTitle>Where this bill stands</SectionTitle>
          <LifecycleProgressBar
            stages={lifecycleStages}
            currentStageId={bill.currentStageId ?? null}
          />
        </div>
      )}

      {/* Last action */}
      {bill.lastAction && (
        <div className="mb-6">
          <SectionTitle>Latest action</SectionTitle>
          <p className="text-sm text-[#334155]">
            {bill.lastActionDate && (
              <span className="text-slate-400 mr-2">
                {formatDate(bill.lastActionDate)}
              </span>
            )}
            {bill.lastAction}
          </p>
        </div>
      )}

      {/* Author & co-authors */}
      <div className="mb-6">
        <SectionTitle>Authorship</SectionTitle>
        {bill.authorName ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500 w-24 shrink-0">Author</span>
              {bill.authorId ? (
                <Link
                  href={`/region/representatives/${bill.authorId}`}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {bill.authorName}
                </Link>
              ) : (
                <span className="text-[#334155] font-medium">
                  {bill.authorName}
                </span>
              )}
            </div>
            {bill.coAuthors.length > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-slate-500 w-24 shrink-0 pt-0.5">
                  Co-authors
                </span>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {bill.coAuthors.map((ca) =>
                    ca.representativeId ? (
                      <Link
                        key={ca.representativeId}
                        href={`/region/representatives/${ca.representativeId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {ca.name}
                      </Link>
                    ) : (
                      <span key={ca.name} className="text-[#334155]">
                        {ca.name}
                      </span>
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm italic text-slate-400">
            Author data not yet available.
          </p>
        )}
      </div>

      <LayerButton onClick={onNext}>See vote record</LayerButton>
    </div>
  );
}

function Votes({
  bill,
  onNext,
  onBack,
}: {
  readonly bill: NonNullable<BillData["bill"]>;
  readonly onNext: () => void;
  readonly onBack: () => void;
}) {
  const chambers = Array.from(new Set(bill.votes.map((v) => v.chamber))).sort();

  if (bill.votes.length === 0) {
    return (
      <div className="animate-layer-enter">
        <ComingSoon
          title="Vote record not yet available"
          description="Roll-call votes will appear here once bill data has been fully indexed for this session."
        />
        <div className="mt-6">
          <LayerButton onClick={onBack} variant="secondary">
            Back to snapshot
          </LayerButton>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-layer-enter">
      {chambers.map((chamber) => {
        const chamberVotes = bill.votes.filter((v) => v.chamber === chamber);
        return (
          <div key={chamber} className="mb-8">
            <SectionTitle>{chamber}</SectionTitle>
            <VoteSummaryBar votes={chamberVotes} />
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Member</th>
                    <th className="px-4 py-2.5">Motion</th>
                    <th className="px-4 py-2.5 text-right">Vote</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {chamberVotes.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-[#222222]">
                        {v.representativeId ? (
                          <Link
                            href={`/region/representatives/${v.representativeId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {v.representativeName}
                          </Link>
                        ) : (
                          v.representativeName
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {v.motionText ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <PositionBadge position={v.position} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-3">
        <LayerButton onClick={onNext}>Sources & deep dive</LayerButton>
        <LayerButton onClick={onBack} variant="secondary">
          Back to snapshot
        </LayerButton>
      </div>
    </div>
  );
}

function Sources({
  bill,
  onBack,
}: {
  readonly bill: NonNullable<BillData["bill"]>;
  readonly onBack: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      {bill.fiscalImpact && (
        <div className="mb-6">
          <SectionTitle>Fiscal impact</SectionTitle>
          <p className="text-sm text-[#334155] leading-relaxed">
            {bill.fiscalImpact}
          </p>
        </div>
      )}

      <SectionTitle>Record details</SectionTitle>
      <dl className="bg-slate-50 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {bill.subject && (
          <div>
            <dt className="font-bold uppercase tracking-wider text-xs text-[#595959] mb-0.5">
              Subject
            </dt>
            <dd className="text-[#334155]">{bill.subject}</dd>
          </div>
        )}
        <div>
          <dt className="font-bold uppercase tracking-wider text-xs text-[#595959] mb-0.5">
            Bill number
          </dt>
          <dd className="font-mono text-[#334155]">{bill.billNumber}</dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-wider text-xs text-[#595959] mb-0.5">
            Session
          </dt>
          <dd className="text-[#334155]">{bill.sessionYear}</dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-wider text-xs text-[#595959] mb-0.5">
            Last updated
          </dt>
          <dd className="text-[#334155]">{formatDate(bill.updatedAt)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-bold uppercase tracking-wider text-xs text-[#595959] mb-0.5">
            Official source
          </dt>
          <dd>
            <a
              href={bill.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline break-all"
            >
              {bill.sourceUrl} ↗
            </a>
          </dd>
        </div>
        {bill.fullTextUrl && (
          <div className="sm:col-span-2">
            <dt className="font-bold uppercase tracking-wider text-xs text-[#595959] mb-0.5">
              Full text
            </dt>
            <dd>
              <a
                href={bill.fullTextUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                View full bill text ↗
              </a>
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-6">
        <LayerButton onClick={onBack} variant="secondary">
          Back to votes
        </LayerButton>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [layer, setLayer] = useState(1);
  const { civics, measureTypeByCode } = useCivics();

  const { data, loading, error } = useQuery<BillData, BillIdVars>(GET_BILL, {
    variables: { id },
  });

  const bill = data?.bill;

  // Resolve the lifecycle stages that apply to this bill's measure type.
  const lifecycleStages = useMemo(() => {
    if (!civics || !bill) return [];
    const measureType = measureTypeByCode.get(bill.measureTypeCode);
    if (!measureType) return civics.lifecycleStages;
    const ids = new Set(measureType.lifecycleStageIds);
    const filtered = civics.lifecycleStages.filter((s) => ids.has(s.id));
    return filtered.length > 0 ? filtered : civics.lifecycleStages;
  }, [civics, bill, measureTypeByCode]);

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
        <ErrorState entity="bill" />
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#4d4d4d] mb-4">Bill not found.</p>
          <Link
            href="/region/bills"
            className="text-blue-600 hover:underline text-sm font-medium"
          >
            Back to bills
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
          { label: "Bills", href: "/region/bills" },
          { label: bill.billNumber },
        ]}
      />

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <MeasureTypeBadge code={bill.measureTypeCode} />
          <span className="font-mono text-sm font-semibold text-[#334155]">
            {bill.billNumber}
          </span>
          <span className="text-sm text-slate-400">{bill.sessionYear}</span>
        </div>
        <h1 className="text-2xl font-extrabold text-[#222222] leading-tight">
          {bill.title}
        </h1>
      </div>

      <LayerNav layers={LAYERS} current={layer} onChange={setLayer} />

      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        {layer === 1 && (
          <Snapshot
            bill={bill}
            lifecycleStages={lifecycleStages}
            onNext={() => setLayer(2)}
          />
        )}
        {layer === 2 && (
          <Votes
            bill={bill}
            onNext={() => setLayer(3)}
            onBack={() => setLayer(1)}
          />
        )}
        {layer === 3 && <Sources bill={bill} onBack={() => setLayer(2)} />}
      </div>
    </div>
  );
}
