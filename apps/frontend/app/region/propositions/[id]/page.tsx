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
  type Proposition,
  type PropositionAnalysisClaim,
} from "@/lib/graphql/region";
import {
  GET_PETITION_DOCUMENTS_FOR_PROPOSITION,
  type PetitionDocumentsForPropositionData,
} from "@/lib/graphql/documents";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { LoadingSkeleton, ErrorState } from "@/components/region/ListStates";
import { SectionTitle } from "@/components/region/SectionTitle";
import { ComingSoon } from "@/components/region/ComingSoon";
import { LayerButton } from "@/components/region/LayerButton";
import { LayerNav } from "@/components/region/LayerNav";
import { YesNoOutcomeCard } from "@/components/region/YesNoOutcomeCard";
import { ClaimAttribution } from "@/components/region/ClaimAttribution";
import { SegmentedFullText } from "@/components/region/SegmentedFullText";
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
] as const;

function claimKey(
  claim: Pick<PropositionAnalysisClaim, "sourceStart" | "sourceEnd">,
): string {
  return `${claim.sourceStart}-${claim.sourceEnd}`;
}

function claimsForField(
  claims: PropositionAnalysisClaim[] | undefined,
  field: string,
): PropositionAnalysisClaim[] {
  return (claims ?? []).filter((c) => c.field === field);
}

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

function QuickView({
  proposition,
  onNext,
}: {
  readonly proposition: Proposition;
  readonly onNext: () => void;
}) {
  const summary = proposition.analysisSummary?.trim() || proposition.summary;
  return (
    <div className="animate-layer-enter">
      <p className="text-lg text-[#475569] leading-relaxed mb-6">{summary}</p>

      {proposition.fiscalImpact && (
        <div className="inline-flex items-start gap-3 px-4 py-3 bg-slate-100 rounded-lg text-sm text-[#334155] mb-6 max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-wider text-[#595959] whitespace-nowrap pt-0.5">
            Fiscal impact
          </span>
          <span className="leading-relaxed">{proposition.fiscalImpact}</span>
        </div>
      )}

      <div className="mt-6">
        <LayerButton onClick={onNext}>Learn More</LayerButton>
      </div>
    </div>
  );
}

function LinkedPetitionScans({
  propositionId,
}: {
  readonly propositionId: string;
}) {
  const { data, loading } = useQuery<PetitionDocumentsForPropositionData>(
    GET_PETITION_DOCUMENTS_FOR_PROPOSITION,
    { variables: { propositionId } },
  );

  const docs = data?.petitionDocumentsForProposition ?? [];

  return (
    <div className="mb-8">
      <SectionTitle>Community Petition Scans</SectionTitle>
      {loading && (
        <div className="bg-slate-50 rounded-xl p-4 text-center text-sm text-slate-500">
          Loading petition scans...
        </div>
      )}

      {!loading && docs.length === 0 && (
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center">
          <p className="text-sm text-slate-700">
            Petition scans related to this measure will appear here as they are
            scanned.
          </p>
        </div>
      )}

      {!loading && docs.length > 0 && (
        <div className="space-y-3">
          {docs.map((doc) => (
            <div key={doc.id} className="border border-gray-200 rounded-xl p-4">
              <p className="text-sm text-[#334155] leading-relaxed">
                {doc.summary}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    doc.linkSource === "auto_analysis"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-purple-100 text-purple-700"
                  }`}
                >
                  {doc.linkSource === "auto_analysis"
                    ? "AI-matched"
                    : "User-linked"}
                </span>
                <span className="text-xs text-slate-600">
                  {formatDate(doc.linkedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Details({
  proposition,
  propositionId,
  onNavigateToClaim,
  onNext,
}: {
  readonly proposition: Proposition;
  readonly propositionId: string;
  readonly onNavigateToClaim: (claim: PropositionAnalysisClaim) => void;
  readonly onNext: () => void;
}) {
  const hasAnalysis =
    !!proposition.analysisSummary ||
    (proposition.keyProvisions?.length ?? 0) > 0;

  return (
    <div className="animate-layer-enter">
      <div className="mb-8">
        <SectionTitle>Key Provisions</SectionTitle>
        {proposition.keyProvisions && proposition.keyProvisions.length > 0 ? (
          <ul className="list-disc pl-5 space-y-2 text-[#334155]">
            {proposition.keyProvisions.map((provision) => (
              <li key={provision} className="leading-relaxed">
                <span>{provision}</span>
                <ClaimAttribution
                  claims={claimsForField(
                    proposition.analysisClaims,
                    "keyProvisions",
                  )}
                  onNavigateToSource={onNavigateToClaim}
                />
              </li>
            ))}
          </ul>
        ) : (
          <ComingSoon
            title="Analysis pending"
            description={
              proposition.fullText
                ? "AI analysis is being generated from the measure text."
                : "Waiting for the full measure text to be extracted."
            }
          />
        )}
      </div>

      {proposition.fiscalImpact && (
        <div className="mb-8">
          <SectionTitle>Fiscal Impact</SectionTitle>
          <p className="text-[#334155] leading-relaxed">
            {proposition.fiscalImpact}
            <ClaimAttribution
              claims={claimsForField(
                proposition.analysisClaims,
                "fiscalImpact",
              )}
              onNavigateToSource={onNavigateToClaim}
            />
          </p>
        </div>
      )}

      {(proposition.yesOutcome || proposition.noOutcome) && (
        <div className="mb-8">
          <SectionTitle>What a Yes / No Vote Means</SectionTitle>
          <YesNoOutcomeCard
            yesOutcome={proposition.yesOutcome}
            noOutcome={proposition.noOutcome}
          />
        </div>
      )}

      {proposition.existingVsProposed &&
        (proposition.existingVsProposed.current ||
          proposition.existingVsProposed.proposed) && (
          <div className="mb-8">
            <SectionTitle>Existing Law vs. This Measure</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="border-2 border-gray-200 rounded-xl p-5">
                <p className="text-xs uppercase tracking-[1.5px] font-extrabold text-[#595959] mb-3">
                  Under Existing Law
                </p>
                <p className="text-sm text-[#334155] leading-relaxed">
                  {proposition.existingVsProposed.current || "Not specified."}
                  <ClaimAttribution
                    claims={claimsForField(
                      proposition.analysisClaims,
                      "existingCurrent",
                    )}
                    onNavigateToSource={onNavigateToClaim}
                  />
                </p>
              </div>
              <div className="border-2 border-gray-200 rounded-xl p-5">
                <p className="text-xs uppercase tracking-[1.5px] font-extrabold text-[#595959] mb-3">
                  If This Passes
                </p>
                <p className="text-sm text-[#334155] leading-relaxed">
                  {proposition.existingVsProposed.proposed || "Not specified."}
                  <ClaimAttribution
                    claims={claimsForField(
                      proposition.analysisClaims,
                      "existingProposed",
                    )}
                    onNavigateToSource={onNavigateToClaim}
                  />
                </p>
              </div>
            </div>
          </div>
        )}

      <LinkedPetitionScans propositionId={propositionId} />

      {!hasAnalysis && (
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
      )}

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
              <span className="w-5 h-5 rounded-full bg-blue-100 border-2 border-blue-500" />{" "}
              Arguments For
            </h4>
            <div className="text-sm text-slate-700 italic">
              AI-generated arguments coming soon
            </div>
          </div>
          <div className="border-2 border-gray-200 rounded-xl p-5">
            <h4 className="flex items-center gap-2 text-xs uppercase tracking-[1.5px] font-extrabold mb-4">
              <span className="w-5 h-5 rounded-full bg-red-100 border-2 border-red-500" />{" "}
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
  proposition,
  focusedClaimKey,
  onBack,
}: {
  readonly proposition: Proposition;
  readonly focusedClaimKey?: string;
  readonly onBack: () => void;
}) {
  return (
    <div className="animate-layer-enter">
      <div className="bg-[#fafafa] rounded-xl border-l-4 border-[#222222] p-6 mb-8">
        <h3 className="text-sm uppercase tracking-[1.5px] font-bold text-[#222222] mb-4">
          Full Documentation
        </h3>
        <ul className="space-y-3">
          {proposition.sourceUrl && (
            <li>
              <a
                href={proposition.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 font-semibold text-sm hover:underline"
              >
                &rarr; Official Source (PDF)
              </a>
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

      {proposition.fullText ? (
        <div className="mb-8">
          <SegmentedFullText
            fullText={proposition.fullText}
            sections={proposition.analysisSections ?? []}
            claims={proposition.analysisClaims ?? []}
            focusedClaimKey={focusedClaimKey}
          />
        </div>
      ) : (
        <div className="mb-8">
          <ComingSoon
            title="Full text pending"
            description="The measure's full text will appear here once it is extracted from the official source."
          />
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
  const [focusedClaimKey, setFocusedClaimKey] = useState<string | undefined>();

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
          <p className="text-[#4d4d4d] mb-4">Proposition not found.</p>
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

  function handleNavigateToClaim(claim: PropositionAnalysisClaim) {
    setFocusedClaimKey(claimKey(claim));
    setLayer(4);
  }

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
        <p className="text-xs font-bold uppercase tracking-[1px] text-[#595959] mb-2">
          {proposition.externalId}
        </p>
        <h1 className="text-2xl font-extrabold text-[#222222] leading-tight mb-3">
          {proposition.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={proposition.status} />
          {electionDate && (
            <span className="text-sm text-[#4d4d4d]">
              Election: {electionDate}
            </span>
          )}
        </div>
      </div>

      {/* Layer Navigation */}
      <LayerNav layers={LAYERS} current={layer} onChange={setLayer} />

      {/* Layer Content */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        {layer === 1 && (
          <QuickView proposition={proposition} onNext={() => setLayer(2)} />
        )}
        {layer === 2 && (
          <Details
            proposition={proposition}
            propositionId={id}
            onNavigateToClaim={handleNavigateToClaim}
            onNext={() => setLayer(3)}
          />
        )}
        {layer === 3 && (
          <BothSides onNext={() => setLayer(4)} onBack={() => setLayer(1)} />
        )}
        {layer === 4 && (
          <DeepDive
            proposition={proposition}
            focusedClaimKey={focusedClaimKey}
            onBack={() => setLayer(1)}
          />
        )}
      </div>
    </div>
  );
}
