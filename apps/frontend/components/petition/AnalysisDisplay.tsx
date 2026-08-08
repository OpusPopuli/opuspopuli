"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type {
  DocumentAnalysis,
  LinkedProposition,
} from "@/lib/graphql/documents";

function getConfidenceBadgeClass(confidence: number): string {
  if (confidence >= 90) return "bg-positive-surface text-positive";
  if (confidence >= 70) return "bg-warning-surface text-warning";
  return "bg-danger-surface text-danger";
}

function getCompletenessBarColor(score: number): string {
  if (score > 80) return "bg-positive-solid";
  if (score >= 50) return "bg-warning-solid";
  return "bg-danger-solid";
}

function getCompletenessTextColor(score: number): string {
  if (score > 80) return "text-positive";
  if (score >= 50) return "text-warning";
  return "text-danger";
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
            <h2 className="text-lg font-semibold text-paper">
              {t("results.extractedText")}
            </h2>
            <span
              className={`text-xs px-2 py-1 rounded-full ${getConfidenceBadgeClass(ocrConfidence)}`}
            >
              {ocrConfidence.toFixed(0)}% {t("results.confidence")}
            </span>
          </div>
          {readOnly ? (
            <div className="w-full bg-inverse-surface text-on-inverse rounded-lg p-4 text-sm leading-relaxed border border-line whitespace-pre-wrap">
              {ocrText}
            </div>
          ) : (
            <textarea
              value={ocrText}
              onChange={(e) => onOcrTextChange?.(e.target.value)}
              className="w-full bg-inverse-surface text-on-inverse rounded-lg p-4 text-sm leading-relaxed border border-line focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-y min-h-[120px]"
              rows={6}
              aria-label={t("results.extractedTextLabel")}
            />
          )}
        </div>
      )}

      {/* Summary */}
      <div>
        <h2 className="text-lg font-semibold text-paper mb-2">
          {t("results.summary")}
        </h2>
        <p className="text-content-dim leading-relaxed">{analysis.summary}</p>
      </div>

      {/* Key Points */}
      {analysis.keyPoints.length > 0 && (
        <div>
          <h3 className="text-md font-semibold text-paper mb-2">
            {t("results.keyPoints")}
          </h3>
          <ul className="space-y-2">
            {analysis.keyPoints.map((point) => (
              <li
                key={point}
                className="flex items-start gap-2 text-content-dim"
              >
                <span className="text-info mt-1 flex-shrink-0">&#8226;</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actual Effect */}
      {analysis.actualEffect && (
        <div>
          <h3 className="text-md font-semibold text-paper mb-2">
            {t("results.actualEffect")}
          </h3>
          <p className="text-content-dim">{analysis.actualEffect}</p>
        </div>
      )}

      {/* Potential Concerns */}
      {analysis.potentialConcerns && analysis.potentialConcerns.length > 0 && (
        <div>
          <h3 className="text-md font-semibold text-warning mb-2">
            {t("results.concerns")}
          </h3>
          <ul className="space-y-1">
            {analysis.potentialConcerns.map((concern) => (
              <li
                key={concern}
                className="flex items-start gap-2 text-content-dim"
              >
                <span className="text-warning mt-1 flex-shrink-0">&#9888;</span>
                <span>{concern}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Beneficiaries */}
      {analysis.beneficiaries && analysis.beneficiaries.length > 0 && (
        <div>
          <h3 className="text-md font-semibold text-positive mb-2">
            {t("results.beneficiaries")}
          </h3>
          <ul className="space-y-1">
            {analysis.beneficiaries.map((b) => (
              <li key={b} className="text-content-dim">
                &#8226; {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Potentially Harmed */}
      {analysis.potentiallyHarmed && analysis.potentiallyHarmed.length > 0 && (
        <div>
          <h3 className="text-md font-semibold text-danger mb-2">
            {t("results.potentiallyHarmed")}
          </h3>
          <ul className="space-y-1">
            {analysis.potentiallyHarmed.map((h) => (
              <li key={h} className="text-content-dim">
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
          <h3 className="text-md font-semibold text-content-dim mb-2">
            {t("results.relatedMeasures")}
          </h3>

          {/* Linked propositions as clickable cards */}
          {linkedPropositions.length > 0 && (
            <div className="space-y-2 mb-3">
              {linkedPropositions.map((prop) => (
                <Link
                  key={prop.id}
                  href={`/region/propositions/${prop.propositionId}`}
                  className="block bg-inverse-surface hover:bg-surface-alt rounded-lg p-3 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-paper font-medium truncate">
                      {prop.title}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-info-surface text-info ml-2 flex-shrink-0">
                      {prop.linkSource === "auto_analysis"
                        ? t("results.linkedAutomatically")
                        : t("results.linkedManually")}
                    </span>
                  </div>
                  <p className="text-sm text-content-dim mt-1">
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
                  <li key={m} className="text-content-dim">
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
          <h3 className="text-md font-semibold text-content-dim mb-2">
            {t("results.entities")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {analysis.entities.map((entity) => (
              <span
                key={entity}
                className="bg-inverse-surface text-on-inverse px-3 py-1 rounded-full text-sm"
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
          <h3 className="text-md font-semibold text-content-dim mb-2">
            {t("results.dataCompleteness")}
          </h3>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-inverse-surface rounded-full h-2.5">
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
            <p className="text-sm text-content-dim mb-2">
              {t("results.completenessExplanation", {
                available: analysis.completenessDetails.availableCount,
                ideal: analysis.completenessDetails.idealCount,
              })}
            </p>
          )}
          {analysis.completenessDetails &&
            analysis.completenessDetails.missingItems.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-warning cursor-pointer hover:text-warning-strong">
                  {t("results.whatWouldImprove")}
                </summary>
                <ul className="mt-1 space-y-1 pl-4">
                  {analysis.completenessDetails.missingItems.map((item) => (
                    <li
                      key={item}
                      className="text-xs text-content-dim list-disc"
                    >
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
          <summary className="text-md font-semibold text-content-dim cursor-pointer hover:text-content">
            {t("results.dataSources")}
          </summary>
          <div className="mt-2 space-y-2">
            {analysis.sources.map((source) => {
              const accessedDate = new Date(source.accessedAt);
              const ageMs = now - accessedDate.getTime();
              const ageDays = ageMs / (1000 * 60 * 60 * 24);
              const getFreshnessStyle = (days: number) => {
                if (days < 1) return "bg-positive-surface text-positive";
                if (days < 7) return "bg-warning-surface text-warning";
                return "bg-danger-surface text-danger";
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
                  className="flex items-center justify-between bg-inverse-surface rounded-lg px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-content-dim truncate">
                      {source.name}
                    </p>
                    <p className="text-sm text-content-dim">
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
      <div className="text-xs text-content-dim pt-4 border-t border-line">
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
              className="text-info hover:text-info-strong underline"
            >
              {t("results.promptCharter")}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
