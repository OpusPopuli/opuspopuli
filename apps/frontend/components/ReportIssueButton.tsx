"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/lib/toast";
import {
  SUBMIT_ABUSE_REPORT,
  type AbuseReportReason,
  type SubmitAbuseReportData,
} from "@/lib/graphql/documents";

const REPORT_REASONS: AbuseReportReason[] = [
  "incorrect_analysis",
  "offensive_content",
  "wrong_document_type",
  "privacy_concern",
  "other",
];

const REASON_I18N_KEYS: Record<AbuseReportReason, string> = {
  incorrect_analysis: "report.reasons.incorrectAnalysis",
  offensive_content: "report.reasons.offensiveContent",
  wrong_document_type: "report.reasons.wrongDocumentType",
  privacy_concern: "report.reasons.privacyConcern",
  other: "report.reasons.other",
};

interface ReportIssueButtonProps {
  documentId: string;
}

export function ReportIssueButton({ documentId }: ReportIssueButtonProps) {
  const { t } = useTranslation("petition");
  const { showToast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [reason, setReason] = useState<AbuseReportReason | null>(null);
  const [description, setDescription] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const [submitReport, { loading }] =
    useMutation<SubmitAbuseReportData>(SUBMIT_ABUSE_REPORT);

  // Close panel on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!reason) return;

    try {
      await submitReport({
        variables: {
          input: {
            documentId,
            reason,
            ...(description.trim() && { description: description.trim() }),
          },
        },
      });

      showToast(t("report.success"), "success");
      setReported(true);
      setIsOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("report.error");

      if (message.includes("already reported")) {
        showToast(t("report.alreadyReported"), "warning");
        setReported(true);
        setIsOpen(false);
      } else {
        showToast(t("report.error"), "error");
      }
    }
  };

  // After successful report, show static "Reported" state
  if (reported) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
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
            d="M5 13l4 4L19 7"
          />
        </svg>
        {t("report.submitted")}
      </span>
    );
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-400 transition-colors"
        aria-label={t("report.buttonLabel")}
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
            d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z"
          />
        </svg>
        {t("report.button")}
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 z-20">
          <h3 className="text-sm font-semibold text-white mb-3">
            {t("report.title")}
          </h3>

          <div className="space-y-2 mb-3">
            {REPORT_REASONS.map((r) => (
              <label
                key={r}
                className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="accent-blue-500"
                />
                {t(REASON_I18N_KEYS[r])}
              </label>
            ))}
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("report.descriptionPlaceholder")}
            maxLength={1000}
            rows={2}
            className="w-full bg-gray-900 text-gray-200 rounded p-2 text-sm border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none mb-3"
          />

          <button
            onClick={handleSubmit}
            disabled={!reason || loading}
            className="w-full py-2 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t("report.submitting") : t("report.submit")}
          </button>
        </div>
      )}
    </div>
  );
}
