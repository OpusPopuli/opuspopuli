"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  PROCESS_SCAN,
  ANALYZE_DOCUMENT,
  SET_DOCUMENT_LOCATION,
  type ProcessScanData,
  type AnalyzeDocumentData,
  type SetDocumentLocationData,
  type DocumentAnalysis,
} from "@/lib/graphql/documents";
import { ReportIssueButton } from "@/components/ReportIssueButton";

type ProcessingStep = "extracting" | "analyzing" | "complete" | "error";

function getConfidenceBadgeClass(confidence: number): string {
  if (confidence >= 90) return "bg-green-900 text-green-300";
  if (confidence >= 70) return "bg-yellow-900 text-yellow-300";
  return "bg-red-900 text-red-300";
}

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

  const [processScan] = useMutation<ProcessScanData>(PROCESS_SCAN);
  const [analyzeDocument] = useMutation<AnalyzeDocumentData>(ANALYZE_DOCUMENT);
  const [setDocumentLocation] = useMutation<SetDocumentLocationData>(
    SET_DOCUMENT_LOCATION,
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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Processing failed";
        setError(message);
        setStep("error");
      }
    },
    [processScan, analyzeDocument, setDocumentLocation],
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

  const confidenceBadgeClass = getConfidenceBadgeClass(ocrConfidence);

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

      {/* OCR Text Section */}
      {ocrText && (
        <section className="px-4 py-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">
              {t("results.extractedText")}
            </h2>
            <span
              className={`text-xs px-2 py-1 rounded-full ${confidenceBadgeClass}`}
            >
              {ocrConfidence.toFixed(0)}% {t("results.confidence")}
            </span>
          </div>
          <textarea
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            className="w-full bg-gray-900 text-gray-200 rounded-lg p-4 text-sm leading-relaxed border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y min-h-[120px]"
            rows={6}
            aria-label={t("results.extractedTextLabel")}
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

      {/* Analysis Section */}
      {analysis && (
        <section className="px-4 py-6 space-y-6">
          {/* Summary */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">
              {t("results.summary")}
            </h2>
            <p className="text-gray-300 leading-relaxed">{analysis.summary}</p>
          </div>

          {/* Key Points */}
          {analysis.keyPoints.length > 0 && (
            <div>
              <h3 className="text-md font-semibold text-white mb-2">
                {t("results.keyPoints")}
              </h3>
              <ul className="space-y-2">
                {analysis.keyPoints.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 text-gray-300"
                  >
                    <span className="text-blue-400 mt-1 flex-shrink-0">
                      &#8226;
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actual Effect */}
          {analysis.actualEffect && (
            <div>
              <h3 className="text-md font-semibold text-white mb-2">
                {t("results.actualEffect")}
              </h3>
              <p className="text-gray-300">{analysis.actualEffect}</p>
            </div>
          )}

          {/* Potential Concerns */}
          {analysis.potentialConcerns &&
            analysis.potentialConcerns.length > 0 && (
              <div>
                <h3 className="text-md font-semibold text-amber-400 mb-2">
                  {t("results.concerns")}
                </h3>
                <ul className="space-y-1">
                  {analysis.potentialConcerns.map((concern) => (
                    <li
                      key={concern}
                      className="flex items-start gap-2 text-gray-300"
                    >
                      <span className="text-amber-400 mt-1 flex-shrink-0">
                        &#9888;
                      </span>
                      <span>{concern}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Beneficiaries */}
          {analysis.beneficiaries && analysis.beneficiaries.length > 0 && (
            <div>
              <h3 className="text-md font-semibold text-green-400 mb-2">
                {t("results.beneficiaries")}
              </h3>
              <ul className="space-y-1">
                {analysis.beneficiaries.map((b) => (
                  <li key={b} className="text-gray-300">
                    &#8226; {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Potentially Harmed */}
          {analysis.potentiallyHarmed &&
            analysis.potentiallyHarmed.length > 0 && (
              <div>
                <h3 className="text-md font-semibold text-red-400 mb-2">
                  {t("results.potentiallyHarmed")}
                </h3>
                <ul className="space-y-1">
                  {analysis.potentiallyHarmed.map((h) => (
                    <li key={h} className="text-gray-300">
                      &#8226; {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Related Measures */}
          {analysis.relatedMeasures && analysis.relatedMeasures.length > 0 && (
            <div>
              <h3 className="text-md font-semibold text-gray-400 mb-2">
                {t("results.relatedMeasures")}
              </h3>
              <ul className="space-y-1">
                {analysis.relatedMeasures.map((m) => (
                  <li key={m} className="text-gray-300">
                    &#8226; {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Entities */}
          {analysis.entities.length > 0 && (
            <div>
              <h3 className="text-md font-semibold text-gray-400 mb-2">
                {t("results.entities")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {analysis.entities.map((entity) => (
                  <span
                    key={entity}
                    className="bg-gray-800 text-gray-300 px-3 py-1 rounded-full text-sm"
                  >
                    {entity}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Provider info footer */}
          <div className="text-xs text-gray-500 pt-4 border-t border-gray-800">
            {t("results.analyzedBy", {
              provider: analysis.provider,
              model: analysis.model,
            })}
            {fromCache && ` (${t("results.cachedResult")})`}
          </div>
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
          <button
            disabled
            className="flex-1 py-3 bg-blue-600/50 text-white/50 font-medium rounded-lg cursor-not-allowed"
            title={t("results.saveComingSoon")}
          >
            {t("results.saveToTrack")}
          </button>
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
