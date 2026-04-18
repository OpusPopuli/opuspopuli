"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useLazyQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  PROCESS_SCAN,
  ANALYZE_DOCUMENT,
  SET_DOCUMENT_LOCATION,
  GET_LINKED_PROPOSITIONS,
  type ProcessScanData,
  type AnalyzeDocumentData,
  type SetDocumentLocationData,
  type LinkedPropositionsData,
  type DocumentAnalysis,
  type LinkedProposition,
} from "@/lib/graphql/documents";
import { ReportIssueButton } from "@/components/ReportIssueButton";
import { TrackOnBallotButton } from "@/components/petition/TrackOnBallotButton";
import { AnalysisDisplay } from "@/components/petition/AnalysisDisplay";

type ProcessingStep = "extracting" | "analyzing" | "complete" | "error";

export default function PetitionResultsPage() {
  const router = useRouter();
  const { t } = useTranslation("petition");
  const hasStarted = useRef(false);

  const [step, setStep] = useState<ProcessingStep>("extracting");
  const [ocrText, setOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState(0);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);

  const [linkedPropositions, setLinkedPropositions] = useState<
    LinkedProposition[]
  >([]);

  const [processScan] = useMutation<ProcessScanData>(PROCESS_SCAN);
  const [analyzeDocument] = useMutation<AnalyzeDocumentData>(ANALYZE_DOCUMENT);
  const [setDocumentLocation] = useMutation<SetDocumentLocationData>(
    SET_DOCUMENT_LOCATION,
  );
  const [fetchLinkedPropositions] = useLazyQuery<LinkedPropositionsData>(
    GET_LINKED_PROPOSITIONS,
  );

  const runPipeline = useCallback(
    async (
      base64: string,
      location: { latitude: number; longitude: number } | null,
    ) => {
      try {
        // Step 1: Process scan (OCR + persist)
        setStep("extracting");
        const scanResult = await processScan({
          variables: {
            input: {
              data: base64,
              mimeType: "image/png",
              documentType: "petition",
            },
          },
        });

        const scan = scanResult.data?.processScan;
        if (!scan) throw new Error("Scan processing failed");

        setOcrText(scan.text);
        setOcrConfidence(scan.confidence);
        setDocumentId(scan.documentId);

        // Step 2: Set location (fire-and-forget)
        if (location) {
          setDocumentLocation({
            variables: {
              input: {
                documentId: scan.documentId,
                location: {
                  latitude: location.latitude,
                  longitude: location.longitude,
                },
              },
            },
          }).catch((err) => console.warn("Location save failed:", err));
        }

        // Step 3: Analyze document
        setStep("analyzing");
        const analysisResult = await analyzeDocument({
          variables: {
            input: { documentId: scan.documentId },
          },
        });

        const analysisData = analysisResult.data?.analyzeDocument;
        if (!analysisData) throw new Error("Analysis failed");

        setAnalysis(analysisData.analysis);
        setFromCache(analysisData.fromCache);
        setStep("complete");

        // Fetch linked propositions (auto-matched during analysis)
        fetchLinkedPropositions({
          variables: { documentId: scan.documentId },
        }).then((res) =>
          setLinkedPropositions(res.data?.linkedPropositions ?? []),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Processing failed";
        setError(message);
        setStep("error");
      }
    },
    [
      processScan,
      analyzeDocument,
      setDocumentLocation,
      fetchLinkedPropositions,
    ],
  );

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const base64 = sessionStorage.getItem("petition-scan-data");
    if (!base64) {
      router.replace("/petition");
      return;
    }

    const locationStr = sessionStorage.getItem("petition-scan-location");
    const location = locationStr
      ? (JSON.parse(locationStr) as { latitude: number; longitude: number })
      : null;

    // Clean up sessionStorage
    sessionStorage.removeItem("petition-scan-data");
    sessionStorage.removeItem("petition-scan-location");

    // eslint-disable-next-line react-hooks/set-state-in-effect
    runPipeline(base64, location);
  }, [router, runPipeline]);

  const handleShare = useCallback(async () => {
    let shareText = ocrText;
    if (analysis) {
      const keyPointsList = analysis.keyPoints.map((p) => "- " + p).join("\n");
      shareText = analysis.summary + "\n\nKey Points:\n" + keyPointsList;
    }

    if (navigator.share) {
      try {
        await navigator.share({ title: "Petition Analysis", text: shareText });
      } catch {
        // User cancelled or share failed — no action needed
      }
    } else {
      await navigator.clipboard.writeText(shareText);
    }
  }, [analysis, ocrText]);

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm px-4 py-4 flex items-center gap-3 border-b border-gray-800">
        <button
          onClick={() => router.push("/petition")}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label={t("results.back")}
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

      {/* Processing Indicator */}
      {(step === "extracting" || step === "analyzing") && !ocrText && (
        <div className="flex flex-col items-center justify-center py-16">
          <LoadingSpinner size="lg" className="text-blue-500 mb-4" />
          <p className="text-white text-lg font-medium">
            {step === "extracting"
              ? t("results.extractingText")
              : t("results.analyzingDocument")}
          </p>
          <p className="text-gray-400 text-sm mt-2">
            {step === "extracting"
              ? t("results.extractingDescription")
              : t("results.analyzingDescription")}
          </p>
        </div>
      )}

      {/* OCR Text (shown before analysis completes) */}
      {ocrText && !analysis && (
        <section className="px-4 py-6">
          <AnalysisDisplay
            analysis={{
              documentType: "petition",
              summary: "",
              keyPoints: [],
              entities: [],
              analyzedAt: "",
              provider: "",
              model: "",
              processingTimeMs: 0,
            }}
            ocrText={ocrText}
            ocrConfidence={ocrConfidence}
            onOcrTextChange={setOcrText}
          />
        </section>
      )}

      {/* Analysis Loading (shown while analyzing, after OCR text is visible) */}
      {step === "analyzing" && ocrText && (
        <div className="flex items-center gap-3 px-4 py-4">
          <LoadingSpinner size="sm" className="text-blue-500" />
          <p className="text-gray-400 text-sm">
            {t("results.analyzingDocument")}
          </p>
        </div>
      )}

      {/* Analysis Display */}
      {analysis && (
        <section className="px-4 py-6">
          <AnalysisDisplay
            analysis={analysis}
            linkedPropositions={linkedPropositions}
            ocrText={ocrText}
            ocrConfidence={ocrConfidence}
            fromCache={fromCache}
            onOcrTextChange={setOcrText}
          />
        </section>
      )}

      {/* Action Buttons */}
      {step === "complete" && (
        <div className="px-4 py-6 flex gap-3">
          <button
            onClick={handleShare}
            className="flex-1 py-3 bg-white/10 text-white font-medium rounded-lg hover:bg-white/20 transition-colors"
          >
            {t("results.share")}
          </button>
          {documentId && (
            <TrackOnBallotButton
              documentId={documentId}
              linkedCount={linkedPropositions.length}
              onLinked={() =>
                fetchLinkedPropositions({
                  variables: { documentId },
                }).then((res) =>
                  setLinkedPropositions(res.data?.linkedPropositions ?? []),
                )
              }
            />
          )}
        </div>
      )}

      {/* Report Issue */}
      {step === "complete" && documentId && (
        <div className="px-4 pb-6 flex justify-end">
          <ReportIssueButton documentId={documentId} />
        </div>
      )}

      {/* Error State */}
      {step === "error" && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <svg
            className="w-16 h-16 mb-4 text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-white mb-2">
            {t("results.errorTitle")}
          </h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <div className="flex gap-3">
            <button
              onClick={() => router.push("/petition")}
              className="px-6 py-3 bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-600 transition-colors"
            >
              {t("results.backToHome")}
            </button>
            <button
              onClick={() => router.push("/petition/capture")}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("results.tryAgain")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
