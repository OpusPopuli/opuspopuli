"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type {
  DocumentAnalysis,
  LinkedProposition,
} from "@/lib/graphql/documents";

function getConfidenceBadgeClass(confidence: number): string {
  if (confidence >= 90) return "bg-green-900 text-green-300";
  if (confidence >= 70) return "bg-yellow-900 text-yellow-300";
  return "bg-red-900 text-red-300";
}

function getCompletenessBarColor(score: number): string {
  if (score > 80) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function getCompletenessTextColor(score: number): string {
  if (score > 80) return "text-green-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

interface AnalysisDisplayProps {
  analysis: DocumentAnalysis;
  linkedPropositions?: LinkedProposition[];
  ocrText?: string;
  ocrConfidence?: number;
  fromCache?: boolean;
  readOnly?: boolean;
  onOcrTextChange?: (text: string) => void;
}

export function AnalysisDisplay({
  analysis,
  linkedPropositions = [],
  ocrText,
  ocrConfidence,
  fromCache = false,
  readOnly = false,
  onOcrTextChange,
}: AnalysisDisplayProps) {
  const { t } = useTranslation("petition");
  const [now] = useState(() => Date.now());

  return (
    <div className="space-y-6">
      {/* OCR Text Section */}
      {ocrText != null && ocrConfidence != null && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">
              {t("results.extractedText")}
            </h2>
            <span
              className={`text-xs px-2 py-1 rounded-full ${getConfidenceBadgeClass(ocrConfidence)}`}
            >
              {ocrConfidence.toFixed(0)}% {t("results.confidence")}
            </span>
          </div>
          {readOnly ? (
            <div className="w-full bg-gray-900 text-gray-200 rounded-lg p-4 text-sm leading-relaxed border border-gray-700 whitespace-pre-wrap">
              {ocrText}
            </div>
          ) : (
            <textarea
              value={ocrText}
              onChange={(e) => onOcrTextChange?.(e.target.value)}
              className="w-full bg-gray-900 text-gray-200 rounded-lg p-4 text-sm leading-relaxed border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y min-h-[120px]"
              rows={6}
              aria-label={t("results.extractedTextLabel")}
            />
          )}
        </div>
      )}

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
              <li key={point} className="flex items-start gap-2 text-gray-300">
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
      {analysis.potentialConcerns && analysis.potentialConcerns.length > 0 && (
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
      {analysis.potentiallyHarmed && analysis.potentiallyHarmed.length > 0 && (
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

      {/* Related Measures / Linked Propositions */}
      {(linkedPropositions.length > 0 ||
        (analysis.relatedMeasures && analysis.relatedMeasures.length > 0)) && (
        <div>
          <h3 className="text-md font-semibold text-gray-400 mb-2">
            {t("results.relatedMeasures")}
          </h3>

          {/* Linked propositions as clickable cards */}
          {linkedPropositions.length > 0 && (
            <div className="space-y-2 mb-3">
              {linkedPropositions.map((prop) => (
                <Link
                  key={prop.id}
                  href={`/region/propositions/${prop.propositionId}`}
                  className="block bg-gray-800 hover:bg-gray-700 rounded-lg p-3 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-white font-medium truncate">
                      {prop.title}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900 text-blue-300 ml-2 flex-shrink-0">
                      {prop.linkSource === "auto_analysis"
                        ? t("results.linkedAutomatically")
                        : t("results.linkedManually")}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {prop.status}
                    {prop.electionDate &&
                      ` · ${new Date(prop.electionDate).toLocaleDateString()}`}
                  </p>
                </Link>
              ))}
            </div>
          )}

          {/* Unmatched text items (measures not yet linked to DB records) */}
          {analysis.relatedMeasures && analysis.relatedMeasures.length > 0 && (
            <ul className="space-y-1">
              {analysis.relatedMeasures
                .filter(
                  (m) =>
                    !linkedPropositions.some(
                      (lp) => lp.matchedText?.toLowerCase() === m.toLowerCase(),
                    ),
                )
                .map((m) => (
                  <li key={m} className="text-gray-300">
                    &#8226; {m}
                  </li>
                ))}
            </ul>
          )}
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

      {/* Data Completeness (#425) */}
      {analysis.completenessScore != null && (
        <div>
          <h3 className="text-md font-semibold text-gray-400 mb-2">
            {t("results.dataCompleteness")}
          </h3>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-gray-800 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full ${getCompletenessBarColor(analysis.completenessScore)}`}
                style={{ width: `${analysis.completenessScore}%` }}
              />
            </div>
            <span
              className={`text-sm font-medium ${getCompletenessTextColor(analysis.completenessScore)}`}
            >
              {t("results.completenessScore", {
                score: analysis.completenessScore,
              })}
            </span>
          </div>
          {analysis.completenessDetails && (
            <p className="text-xs text-gray-400 mb-2">
              {t("results.completenessExplanation", {
                available: analysis.completenessDetails.availableCount,
                ideal: analysis.completenessDetails.idealCount,
              })}
            </p>
          )}
          {analysis.completenessDetails &&
            analysis.completenessDetails.missingItems.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-amber-400 cursor-pointer hover:text-amber-300">
                  {t("results.whatWouldImprove")}
                </summary>
                <ul className="mt-1 space-y-1 pl-4">
                  {analysis.completenessDetails.missingItems.map((item) => (
                    <li key={item} className="text-xs text-gray-400 list-disc">
                      {item}
                    </li>
                  ))}
                </ul>
              </details>
            )}
        </div>
      )}

      {/* Data Sources (#423) */}
      {analysis.sources && analysis.sources.length > 0 && (
        <details>
          <summary className="text-md font-semibold text-gray-400 cursor-pointer hover:text-gray-300">
            {t("results.dataSources")}
          </summary>
          <div className="mt-2 space-y-2">
            {analysis.sources.map((source) => {
              const accessedDate = new Date(source.accessedAt);
              const ageMs = now - accessedDate.getTime();
              const ageDays = ageMs / (1000 * 60 * 60 * 24);
              const getFreshnessStyle = (days: number) => {
                if (days < 1) return "bg-green-900 text-green-300";
                if (days < 7) return "bg-yellow-900 text-yellow-300";
                return "bg-red-900 text-red-300";
              };
              const getFreshnessLabel = (days: number) => {
                if (days < 1) return t("results.sourceFresh");
                if (days < 7) return t("results.sourceAging");
                return t("results.sourceStale");
              };
              const freshnessClass = getFreshnessStyle(ageDays);
              const freshnessLabel = getFreshnessLabel(ageDays);

              return (
                <div
                  key={source.name}
                  className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-300 truncate">
                      {source.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {t("results.sourceAccessedAt", {
                        date: accessedDate.toLocaleDateString(),
                      })}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${freshnessClass}`}
                  >
                    {freshnessLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Provider info footer */}
      <div className="text-xs text-gray-400 pt-4 border-t border-gray-800">
        <p>
          {t("results.analyzedBy", {
            provider: analysis.provider,
            model: analysis.model,
          })}
          {fromCache && ` (${t("results.cachedResult")})`}
        </p>
        {/* Prompt version (#424) */}
        {analysis.promptHash && (
          <p
            className="mt-1"
            title={t("results.promptVersionTooltip", {
              version: analysis.promptVersion ?? "unknown",
              hash: analysis.promptHash.slice(0, 8),
            })}
          >
            {t("results.promptVersion", {
              hash: analysis.promptHash.slice(0, 8),
            })}{" "}
            <a
              href="/transparency/prompt-charter"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              {t("results.promptCharter")}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
