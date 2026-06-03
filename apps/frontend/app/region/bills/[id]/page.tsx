"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import type { CivicsLifecycleStage } from "@/lib/graphql/region";
import {
  GET_BILL,
  type BillAiFiscalImpact,
  type BillAiSummary,
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
import { BillActivityFeed } from "@/components/region/BillActivityFeed";
import { formatDate } from "@/lib/format";
import { MEASURE_TYPE_STYLES } from "@/lib/bill-styles";
import { useState, useMemo } from "react";

const LAYERS = [
  { n: 1, label: "Snapshot" },
  { n: 2, label: "History" },
  { n: 3, label: "Votes" },
  { n: 4, label: "Sources" },
] as const;

const POSITION_STYLES: Record<string, { cls: string; label: string }> = {
  yes: { cls: "bg-green-100 text-green-800", label: "Yes" },
  no: { cls: "bg-red-100 text-red-800", label: "No" },
  abstain: { cls: "bg-yellow-100 text-yellow-800", label: "Abstain" },
  absent: { cls: "bg-gray-100 text-gray-600", label: "Absent" },
  excused: { cls: "bg-blue-100 text-blue-700", label: "Excused" },
  no_vote: { cls: "bg-gray-100 text-gray-400", label: "—" },
};

const FISCAL_LEVEL_STYLES: Record<string, { cls: string; label: string }> = {
  none: { cls: "bg-gray-100 text-gray-600", label: "No fiscal impact" },
  low: { cls: "bg-green-100 text-green-800", label: "Low fiscal impact" },
  medium: { cls: "bg-amber-100 text-amber-800", label: "Medium fiscal impact" },
  high: { cls: "bg-red-100 text-red-800", label: "High fiscal impact" },
};

function humanizeTag(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

/**
 * Banner shown when the bill is no longer in the active legislative process
 * (#747). Deep links to chaptered or dead bills still resolve so external
 * citations don't 404, but the reader deserves a heads-up about the
 * current state. Dead → amber warning; chaptered (signed into law) → green
 * informational. Status + final-action date come straight from the DB
 * columns the sync pipeline populates.
 */
function InactiveBillBanner({
  isDead,
  status,
  lastActionDate,
}: {
  readonly isDead: boolean;
  readonly status?: string;
  readonly lastActionDate?: string;
}) {
  const finalAction = [
    status,
    lastActionDate ? formatDate(lastActionDate) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tone = isDead
    ? "border-amber-400 bg-amber-50 text-amber-900"
    : "border-green-500 bg-green-50 text-green-900";
  const headline = isDead
    ? "This bill is no longer active."
    : "This bill has been signed into law.";

  return (
    <div
      role="status"
      className={`mb-6 rounded-lg border-l-4 px-4 py-3 text-sm ${tone}`}
    >
      <span className="font-semibold">{headline}</span>
      {finalAction && (
        <span className="ml-1">Final status: {finalAction}.</span>
      )}
    </div>
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

// ── AI summary block (Snapshot layer header) ──────────────────────────────────

function TagChip({ label }: { readonly label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-[#334155]">
      {label}
    </span>
  );
}

function ChipRow({
  label,
  tags,
}: {
  readonly label: string;
  readonly tags: readonly string[];
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-[#595959]">
        {label}
      </span>
      {tags.map((t) => (
        <TagChip key={t} label={humanizeTag(t)} />
      ))}
    </div>
  );
}

function FiscalImpactBadge({
  fiscalImpact,
}: {
  readonly fiscalImpact: BillAiFiscalImpact;
}) {
  const style =
    FISCAL_LEVEL_STYLES[fiscalImpact.level] ?? FISCAL_LEVEL_STYLES.none;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.cls}`}
    >
      {style.label}
    </span>
  );
}

function AiSummaryBlock({ summary }: { readonly summary: BillAiSummary }) {
  return (
    <section
      aria-label="Plain-English summary"
      className="mb-6 rounded-lg border-l-4 border-[var(--color-sage)] bg-slate-50 p-5"
    >
      <p className="text-base leading-relaxed text-[#222222]">
        {summary.plainEnglishSummary}
      </p>
      {summary.stakeholderImpact && (
        <p className="mt-3 text-sm leading-relaxed text-[#334155]">
          <span className="font-semibold">Who this affects: </span>
          {summary.stakeholderImpact}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <FiscalImpactBadge fiscalImpact={summary.fiscalImpact} />
        <ChipRow label="Topics" tags={summary.topics} />
        <ChipRow label="Audience" tags={summary.whoItAffects} />
      </div>
    </section>
  );
}

function AiSummaryPending() {
  return (
    <section
      aria-label="Plain-English summary"
      className="mb-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500"
    >
      Plain-English summary pending. This bill hasn’t been processed by the
      summarizer yet — check back shortly.
    </section>
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
      {/* Plain-English AI summary (or pending placeholder) */}
      {bill.aiSummary ? (
        <AiSummaryBlock summary={bill.aiSummary} />
      ) : (
        <AiSummaryPending />
      )}

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

      <LayerButton onClick={onNext}>See bill history</LayerButton>
    </div>
  );
}

function History({
  bill,
  onNext,
  onBack,
}: {
  readonly bill: NonNullable<BillData["bill"]>;
  readonly onNext: () => void;
  readonly onBack: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <SectionTitle>What has happened to this bill</SectionTitle>
      <p className="text-sm text-slate-500 mb-4">
        Committee reports, amendments, and chamber movements extracted from
        official legislative journals and weekly histories.
      </p>
      <BillActivityFeed billId={bill.id} />

      <div className="mt-6 flex flex-wrap gap-3">
        <LayerButton onClick={onNext}>See vote record</LayerButton>
        <LayerButton onClick={onBack} variant="secondary">
          Back to snapshot
        </LayerButton>
      </div>
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
            Back to history
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
          Back to history
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
  // `||` (not `??`) so an empty-string summary still falls back to the
  // legacy column; the LLM contract says summary is non-empty but we don't
  // want a stray "" to render an empty paragraph.
  const fiscalImpactBody =
    bill.aiSummary?.fiscalImpact?.summary || bill.fiscalImpact;
  return (
    <div className="animate-layer-enter">
      {fiscalImpactBody && (
        <div className="mb-6">
          <SectionTitle>Fiscal impact</SectionTitle>
          <p className="text-sm text-[#334155] leading-relaxed">
            {fiscalImpactBody}
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
  // Fall back to the full stage list if the measure type filter would hide the
  // current stage — guards against civics_blocks data that omits terminal stages.
  const lifecycleStages = useMemo(() => {
    if (!civics || !bill) return [];
    const measureType = measureTypeByCode.get(bill.measureTypeCode);
    if (!measureType) return civics.lifecycleStages;
    const ids = new Set(measureType.lifecycleStageIds);
    const filtered = civics.lifecycleStages.filter((s) => ids.has(s.id));
    if (filtered.length === 0) return civics.lifecycleStages;
    if (
      bill.currentStageId &&
      !filtered.some((s) => s.id === bill.currentStageId)
    ) {
      return civics.lifecycleStages;
    }
    return filtered;
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

      {!bill.isActive && (
        <InactiveBillBanner
          isDead={bill.isDead}
          status={bill.status}
          lastActionDate={bill.lastActionDate}
        />
      )}

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
          <History
            bill={bill}
            onNext={() => setLayer(3)}
            onBack={() => setLayer(1)}
          />
        )}
        {layer === 3 && (
          <Votes
            bill={bill}
            onNext={() => setLayer(4)}
            onBack={() => setLayer(2)}
          />
        )}
        {layer === 4 && <Sources bill={bill} onBack={() => setLayer(3)} />}
      </div>
    </div>
  );
}
