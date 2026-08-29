"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_SCAN_DETAIL,
  GET_LINKED_PROPOSITIONS,
  SOFT_DELETE_SCAN,
  type ScanDetailData,
  type LinkedPropositionsData,
  type SoftDeleteScanData,
} from "@/lib/graphql/documents";
import { AnalysisDisplay } from "@/components/petition/AnalysisDisplay";
import { NotAPetition } from "@/components/petition/NotAPetition";
import { VerificationBanner } from "@/components/petition/VerificationBanner";
import { PersonalizedImpact } from "@/components/petition/PersonalizedImpact";
import { usePersonalizedImpact } from "@/components/petition/usePersonalizedImpact";
import { ReportIssueButton } from "@/components/ReportIssueButton";
import { TrackOnBallotButton } from "@/components/petition/TrackOnBallotButton";
import { ConfirmDialog } from "@/components/settings/ConfirmDialog";

const LIST_HREF = "/settings/scans";

function BackLink({ label }: { readonly label: string }) {
  return (
    <Link
      href={LIST_HREF}
      className="inline-flex items-center gap-1.5 text-sm text-content-dim hover:text-content transition-colors no-underline"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 19l-7-7 7-7"
        />
      </svg>
      {label}
    </Link>
  );
}

export default function SettingsScanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation(["settings", "common"]);
  const documentId = params.id as string;

  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, loading, error } = useQuery<ScanDetailData>(GET_SCAN_DETAIL, {
    variables: { documentId },
  });

  const { data: linkedData, refetch: refetchLinked } =
    useQuery<LinkedPropositionsData>(GET_LINKED_PROPOSITIONS, {
      variables: { documentId },
    });

  const [softDeleteScan] = useMutation<SoftDeleteScanData>(SOFT_DELETE_SCAN);

  const scan = data?.scanDetail;
  const linkedPropositions = linkedData?.linkedPropositions ?? [];
  // Non-petition verdict (#1057): the rejection state replaces the analysis on
  // this surface too — no share, no track.
  const notAPetition = scan?.analysis?.isPetition === false;

  // "What this means to you" (#1052) on the revisit surface as well — the live
  // results page already leads with it, and the per-user cache row from that
  // first scan makes this render instantly. Never for a rejected scan.
  const personalizedImpact = usePersonalizedImpact(
    documentId,
    Boolean(scan?.analysis) && !notAPetition,
  );

  const handleShare = useCallback(async () => {
    if (!scan?.analysis) return;
    const keyPointsList = scan.analysis.keyPoints
      .map((p) => "- " + p)
      .join("\n");
    const shareText =
      scan.analysis.summary + "\n\nKey Points:\n" + keyPointsList;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Petition Analysis", text: shareText });
      } catch {
        // cancelled
      }
    } else {
      await navigator.clipboard.writeText(shareText);
    }
  }, [scan]);

  const handleDelete = async () => {
    await softDeleteScan({ variables: { documentId } });
    setConfirmDelete(false);
    router.push(LIST_HREF);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <BackLink label={t("scans.backToList")} />
        <div className="bg-surface rounded-lg border border-line p-6">
          <p className="text-center py-8 text-content-dim">
            {t("common:status.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (error || !scan) {
    return (
      <div className="space-y-6">
        <BackLink label={t("scans.backToList")} />
        <div className="bg-surface rounded-lg border border-line p-6 text-center py-12">
          <h1 className="text-lg font-semibold text-content mb-2">
            {t("scans.scanNotFound")}
          </h1>
          <p className="text-sm text-content-dim mb-6">
            {t("scans.scanNotFoundDescription")}
          </p>
          <Link
            href={LIST_HREF}
            className="inline-block px-6 py-3 bg-inverse-surface text-on-inverse rounded-lg font-medium no-underline hover:opacity-90 transition-opacity"
          >
            {t("scans.backToList")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <BackLink label={t("scans.backToList")} />
        <h1 className="mt-2 text-2xl font-semibold text-content">
          {t("scans.detailTitle")}
        </h1>
        <p className="mt-1 text-sm text-content-dim">
          {t("scans.scannedAt", {
            date: new Date(scan.createdAt).toLocaleString(),
          })}
        </p>
      </div>

      {notAPetition && (
        <div className="bg-surface rounded-lg border border-line">
          <NotAPetition skipReason={scan.analysis?.skipReason} />
        </div>
      )}

      {/* Raw OCR text is intentionally not surfaced — see AnalysisDisplay. */}
      {scan.analysis && !notAPetition && (
        <div className="bg-surface rounded-lg border border-line p-6 space-y-6">
          {/* Provenance first (#1074) — see the results page. */}
          <VerificationBanner
            verificationState={scan.analysis.verificationState}
            matchedExternalId={scan.analysis.matchedExternalId}
          />
          <PersonalizedImpact {...personalizedImpact} />
          <AnalysisDisplay
            analysis={scan.analysis}
            linkedPropositions={linkedPropositions}
          />
        </div>
      )}

      {/* Never offer share/track on a rejected scan; report and delete below
          stay, since report is the false-negative escape hatch. */}
      {!notAPetition && (
        <div className="bg-surface rounded-lg border border-line p-6 flex flex-wrap gap-3">
          {scan.analysis && (
            <button
              onClick={handleShare}
              className="flex-1 min-w-[10rem] py-3 bg-surface-alt text-content font-medium rounded-lg hover:bg-surface-sunk transition-colors"
            >
              {t("scans.share")}
            </button>
          )}
          <TrackOnBallotButton
            documentId={documentId}
            linkedCount={linkedPropositions.length}
            onLinked={() => refetchLinked()}
          />
        </div>
      )}

      <div className="bg-surface rounded-lg border border-line p-6 flex items-center justify-between gap-4 flex-wrap">
        <ReportIssueButton documentId={documentId} />
        <button
          onClick={() => setConfirmDelete(true)}
          className="px-4 py-2 text-sm font-medium text-danger hover:text-danger-strong hover:bg-danger-surface rounded-lg transition-colors"
        >
          {t("scans.deleteScan")}
        </button>
      </div>

      {scan.ocrProvider && (
        <p className="text-xs text-content-dim">
          {t("scans.ocrProvider", { provider: scan.ocrProvider })}
        </p>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={t("scans.deleteConfirm")}
          confirmLabel={t("scans.delete")}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
