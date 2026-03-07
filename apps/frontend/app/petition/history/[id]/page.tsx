"use client";

import { useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  GET_SCAN_DETAIL,
  GET_LINKED_PROPOSITIONS,
  SOFT_DELETE_SCAN,
  type ScanDetailData,
  type LinkedPropositionsData,
  type SoftDeleteScanData,
} from "@/lib/graphql/documents";
import { AnalysisDisplay } from "@/components/petition/AnalysisDisplay";
import { ReportIssueButton } from "@/components/ReportIssueButton";
import { TrackOnBallotButton } from "@/components/petition/TrackOnBallotButton";

export default function ScanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation("petition");
  const documentId = params.id as string;

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
    if (!confirm(t("history.deleteConfirm"))) return;
    await softDeleteScan({ variables: { documentId } });
    router.push("/petition/history");
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm px-4 py-4 flex items-center gap-3 border-b border-gray-800">
        <button
          onClick={() => router.push("/petition/history")}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label={t("history.backToHistory")}
        >
          <svg
            className="w-6 h-6"
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
        </button>
        <h1 className="text-lg font-semibold text-white">
          {t("results.title")}
        </h1>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <LoadingSpinner size="lg" className="text-blue-500 mb-4" />
        </div>
      )}

      {/* Error / Not Found */}
      {(error || (!loading && !scan)) && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <svg
            className="w-16 h-16 mb-4 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h2 className="text-lg font-semibold text-white mb-2">
            {t("history.scanNotFound")}
          </h2>
          <p className="text-gray-400 mb-6">
            {t("history.scanNotFoundDescription")}
          </p>
          <button
            onClick={() => router.push("/petition/history")}
            className="px-6 py-3 bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-600 transition-colors"
          >
            {t("history.backToHistory")}
          </button>
        </div>
      )}

      {/* Scan Detail */}
      {scan && (
        <>
          {/* Analysis */}
          {scan.analysis ? (
            <section className="px-4 py-6">
              <AnalysisDisplay
                analysis={scan.analysis}
                linkedPropositions={linkedPropositions}
                ocrText={scan.extractedText}
                ocrConfidence={scan.ocrConfidence}
                readOnly
              />
            </section>
          ) : (
            /* OCR text only (no analysis) */
            scan.extractedText && (
              <section className="px-4 py-6">
                <AnalysisDisplay
                  analysis={{
                    documentType: scan.type,
                    summary: "",
                    keyPoints: [],
                    entities: [],
                    analyzedAt: "",
                    provider: "",
                    model: "",
                    processingTimeMs: 0,
                  }}
                  ocrText={scan.extractedText}
                  ocrConfidence={scan.ocrConfidence}
                  readOnly
                />
              </section>
            )
          )}

          {/* Action Buttons */}
          <div className="px-4 py-6 flex gap-3">
            {scan.analysis && (
              <button
                onClick={handleShare}
                className="flex-1 py-3 bg-white/10 text-white font-medium rounded-lg hover:bg-white/20 transition-colors"
              >
                {t("history.share")}
              </button>
            )}
            <TrackOnBallotButton
              documentId={documentId}
              linkedCount={linkedPropositions.length}
              onLinked={() => refetchLinked()}
            />
          </div>

          {/* Report & Delete */}
          <div className="px-4 pb-6 flex items-center justify-between">
            <ReportIssueButton documentId={documentId} />
            <button
              onClick={handleDelete}
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              {t("history.delete")}
            </button>
          </div>

          {/* Meta */}
          <div className="px-4 pb-8 text-xs text-gray-600">
            <p>Scanned {new Date(scan.createdAt).toLocaleString()}</p>
            {scan.ocrProvider && <p>OCR: {scan.ocrProvider}</p>}
          </div>
        </>
      )}
    </div>
  );
}
