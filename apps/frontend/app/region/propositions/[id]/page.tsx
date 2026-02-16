"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import {
  GET_PROPOSITION,
  PropositionData,
  PropositionStatus,
  IdVars,
} from "@/lib/graphql/region";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { LoadingSkeleton, ErrorState } from "@/components/region/ListStates";
import { formatDate } from "@/lib/format";

const STATUS_STYLES: Record<
  PropositionStatus,
  { bg: string; text: string; label: string }
> = {
  PENDING: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Pending" },
  PASSED: { bg: "bg-green-100", text: "text-green-800", label: "Passed" },
  FAILED: { bg: "bg-red-100", text: "text-red-800", label: "Failed" },
  WITHDRAWN: { bg: "bg-gray-100", text: "text-gray-800", label: "Withdrawn" },
};

const LAYERS = [
  { n: 1, label: "Quick View" },
  { n: 2, label: "Details" },
  { n: 3, label: "Both Sides" },
  { n: 4, label: "Deep Dive" },
];

function StatusBadge({ status }: { readonly status: PropositionStatus }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

function LayerNav({
  current,
  onChange,
}: {
  readonly current: number;
  readonly onChange: (layer: number) => void;
}) {
  return (
    <nav
      className="flex flex-wrap items-center gap-4 mb-8"
      aria-label="Information depth"
    >
      {LAYERS.map(({ n, label }) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`flex items-center gap-2 text-sm font-medium transition-colors ${
            current === n
              ? "text-[#222222]"
              : "text-[#666666] hover:text-[#555555]"
          }`}
          aria-current={current === n ? "step" : undefined}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              current === n ? "bg-[#222222]" : "bg-[#cccccc]"
            }`}
          />
          {label}
        </button>
      ))}
    </nav>
  );
}

function SectionTitle({ children }: { readonly children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-[1.5px] text-[#666666] mb-3">
      {children}
    </h3>
  );
}

function ComingSoon({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
        {title}
      </p>
      <p className="text-sm text-slate-700">{description}</p>
    </div>
  );
}

function LayerButton({
  onClick,
  variant = "primary",
  children,
}: {
  readonly onClick: () => void;
  readonly variant?: "primary" | "secondary";
  readonly children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        variant === "primary"
          ? "px-6 py-3 bg-gray-900 text-white rounded-lg font-semibold text-sm hover:bg-gray-800 transition-colors"
          : "px-5 py-2.5 bg-white text-gray-900 border-2 border-gray-200 rounded-lg font-semibold text-sm hover:border-gray-900 transition-colors"
      }
    >
      {children}
    </button>
  );
}

function QuickView({
  summary,
  onNext,
}: {
  readonly summary: string;
  readonly onNext: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <p className="text-lg text-[#475569] leading-relaxed mb-6">{summary}</p>

      <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-lg text-sm font-semibold text-[#334155] mb-6">
        <span className="w-3 h-3 rounded-full bg-slate-300" />
        Impact analysis coming soon
      </div>

      <div className="mt-6">
        <LayerButton onClick={onNext}>Learn More</LayerButton>
      </div>
    </div>
  );
}

function Details({
  fullText,
  onNext,
}: {
  readonly fullText?: string;
  readonly onNext: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <div className="mb-8">
        <SectionTitle>What This Does</SectionTitle>
        {fullText ? (
          <p className="text-[#334155] leading-relaxed">{fullText}</p>
        ) : (
          <ComingSoon
            title="Plain-Language Explanation"
            description="AI-powered explanation coming soon"
          />
        )}
      </div>

      <div className="mb-8">
        <SectionTitle>Key Facts</SectionTitle>
        <ComingSoon
          title="Coming Soon"
          description="AI-extracted key facts and figures"
        />
      </div>

      <div className="mb-8">
        <SectionTitle>Who&apos;s Funding This</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
              Yes Campaign
            </p>
            <p className="text-sm text-slate-700">Funding data coming soon</p>
          </div>
          <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
              No Campaign
            </p>
            <p className="text-sm text-slate-700">Funding data coming soon</p>
          </div>
        </div>
      </div>

      <LayerButton onClick={onNext}>See Both Sides</LayerButton>
    </div>
  );
}

function BothSides({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <div className="mb-8">
        <SectionTitle>Best Arguments From Each Side</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="border-2 border-gray-200 rounded-xl p-5">
            <h4 className="flex items-center gap-2 text-xs uppercase tracking-[1.5px] font-extrabold mb-4">
              <span className="w-5 h-5 rounded-full bg-blue-100 border-2 border-blue-500" />
              Arguments For
            </h4>
            <div className="text-sm text-slate-700 italic">
              AI-generated arguments coming soon
            </div>
          </div>
          <div className="border-2 border-gray-200 rounded-xl p-5">
            <h4 className="flex items-center gap-2 text-xs uppercase tracking-[1.5px] font-extrabold mb-4">
              <span className="w-5 h-5 rounded-full bg-red-100 border-2 border-red-500" />
              Arguments Against
            </h4>
            <div className="text-sm text-slate-700 italic">
              AI-generated arguments coming soon
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <SectionTitle>Analysis</SectionTitle>
        <ComingSoon
          title="Economic & Policy Analysis"
          description="AI-powered analysis of economic and policy implications coming soon"
        />
      </div>

      <div className="flex items-center gap-3">
        <LayerButton onClick={onNext}>Full Details & Sources</LayerButton>
        <LayerButton onClick={onBack} variant="secondary">
          Back to Summary
        </LayerButton>
      </div>
    </div>
  );
}

function DeepDive({
  sourceUrl,
  fullText,
  onBack,
}: {
  readonly sourceUrl?: string;
  readonly fullText?: string;
  readonly onBack: () => void;
}) {
  const [showFullText, setShowFullText] = useState(false);

  return (
    <div className="animate-layer-enter">
      <div className="bg-[#fafafa] rounded-xl border-l-4 border-[#222222] p-6 mb-8">
        <h3 className="text-sm uppercase tracking-[1.5px] font-bold text-[#222222] mb-4">
          Full Documentation
        </h3>
        <ul className="space-y-3">
          {sourceUrl && (
            <li>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 font-semibold text-sm hover:underline"
              >
                &rarr; Official Source
              </a>
            </li>
          )}
          {fullText && (
            <li>
              <button
                onClick={() => setShowFullText(!showFullText)}
                className="text-blue-600 font-semibold text-sm hover:underline text-left"
              >
                &rarr; {showFullText ? "Hide" : "Read"} Full Proposition Text
              </button>
            </li>
          )}
          <li className="text-sm text-slate-600">
            &rarr; Legislative Analyst&apos;s Office Analysis (coming soon)
          </li>
          <li className="text-sm text-slate-600">
            &rarr; News Coverage (coming soon)
          </li>
          <li className="text-sm text-slate-600">
            &rarr; Campaign Finance Details (coming soon)
          </li>
        </ul>
      </div>

      {showFullText && fullText && (
        <div className="mb-8 bg-white border border-gray-200 rounded-xl p-6">
          <SectionTitle>Full Proposition Text</SectionTitle>
          <p className="text-sm text-[#334155] leading-relaxed whitespace-pre-line">
            {fullText}
          </p>
        </div>
      )}

      <LayerButton onClick={onBack} variant="secondary">
        Back to Summary
      </LayerButton>
    </div>
  );
}

export default function PropositionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [layer, setLayer] = useState(1);

  const { data, loading, error } = useQuery<PropositionData, IdVars>(
    GET_PROPOSITION,
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
        <ErrorState entity="proposition" />
      </div>
    );
  }

  const proposition = data?.proposition;

  if (!proposition) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#555555] mb-4">Proposition not found.</p>
          <Link
            href="/region/propositions"
            className="text-blue-600 hover:text-blue-700 hover:underline text-sm font-medium"
          >
            Back to Propositions
          </Link>
        </div>
      </div>
    );
  }

  const electionDate = proposition.electionDate
    ? formatDate(proposition.electionDate)
    : null;

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <Breadcrumb
        segments={[
          { label: "Region", href: "/region" },
          { label: "Propositions", href: "/region/propositions" },
          { label: proposition.externalId },
        ]}
      />

      {/* Persistent Header */}
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[1px] text-[#666666] mb-2">
          {proposition.externalId}
        </p>
        <h1 className="text-2xl font-extrabold text-[#222222] leading-tight mb-3">
          {proposition.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={proposition.status} />
          {electionDate && (
            <span className="text-sm text-[#555555]">
              Election: {electionDate}
            </span>
          )}
        </div>
      </div>

      {/* Layer Navigation */}
      <LayerNav current={layer} onChange={setLayer} />

      {/* Layer Content */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        {layer === 1 && (
          <QuickView summary={proposition.summary} onNext={() => setLayer(2)} />
        )}
        {layer === 2 && (
          <Details fullText={proposition.fullText} onNext={() => setLayer(3)} />
        )}
        {layer === 3 && (
          <BothSides onNext={() => setLayer(4)} onBack={() => setLayer(1)} />
        )}
        {layer === 4 && (
          <DeepDive
            sourceUrl={proposition.sourceUrl}
            fullText={proposition.fullText}
            onBack={() => setLayer(1)}
          />
        )}
      </div>
    </div>
  );
}
