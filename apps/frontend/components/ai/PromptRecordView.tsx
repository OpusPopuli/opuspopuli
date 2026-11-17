"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  PROMPT_SERVICE_REPO_URL,
  type PromptRecord,
} from "@/lib/prompt-record";

/**
 * The published prompt behind a fingerprint (#1450).
 *
 * Four outcomes, kept apart on purpose: a published prompt; a fingerprint the
 * public record does not hold (said plainly — that is itself a finding); a
 * value that is not a fingerprint; and a record we could not read right now,
 * which must never be shown as "not published".
 */
export function PromptRecordView({
  record,
}: {
  readonly record: PromptRecord;
}) {
  const { t } = useTranslation("common");

  return (
    <article>
      <div className="mb-6">
        <Link
          href="/transparency"
          className="text-sm text-info hover:underline"
        >
          &larr; {t("promptRecord.back")}
        </Link>
      </div>
      <h1 className="text-3xl font-bold text-content mb-2">
        {t("promptRecord.title")}
      </h1>
      <p className="mb-6 text-sm text-content-dim">
        {t("promptRecord.fingerprint")}{" "}
        <code className="break-all font-mono">{record.hash}</code>
      </p>
      <Body record={record} />
    </article>
  );
}

function Body({ record }: { readonly record: PromptRecord }) {
  const { t } = useTranslation("common");

  if (record.status === "invalid") {
    return <p className="text-content">{t("promptRecord.invalid")}</p>;
  }
  if (record.status === "unavailable") {
    return (
      <p role="status" className="text-content">
        {t("promptRecord.unavailable")}{" "}
        <a
          href={`${PROMPT_SERVICE_REPO_URL}/tree/main/attestation`}
          className="text-info hover:underline"
        >
          {t("promptRecord.recordLink")}
        </a>
      </p>
    );
  }
  if (record.status === "unpublished") {
    return (
      <p className="text-content">
        {t("promptRecord.unpublished")}{" "}
        <a
          href={`${PROMPT_SERVICE_REPO_URL}/tree/main/attestation`}
          className="text-info hover:underline"
        >
          {t("promptRecord.recordLink")}
        </a>
      </p>
    );
  }

  return (
    <div className="space-y-6 text-content">
      <section aria-labelledby="prompt-labels">
        <h2 id="prompt-labels" className="text-xl font-semibold mb-2">
          {t("promptRecord.whichPrompt")}
        </h2>
        <ul className="list-disc pl-6">
          {record.labels.map((label) => (
            <li key={`${label.name}@${label.version}`}>
              <code className="font-mono">{label.name}</code>{" "}
              {t("promptRecord.version", { version: label.version })}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="prompt-text">
        <h2 id="prompt-text" className="text-xl font-semibold mb-2">
          {t("promptRecord.textHeading")}
        </h2>
        <p className="mb-3 text-sm text-content-dim">
          {t("promptRecord.placeholders", { marker: "{{TEXT}}" })}
        </p>
        {/* Focusable so keyboard users can scroll a long prompt. */}
        <pre
          tabIndex={0}
          aria-label={t("promptRecord.textHeading")}
          className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-4 text-xs font-mono"
        >
          {record.text}
        </pre>
      </section>

      <section aria-labelledby="prompt-verify">
        <h2 id="prompt-verify" className="text-xl font-semibold mb-2">
          {t("promptRecord.verifyHeading")}
        </h2>
        <p className="mb-3">{t("promptRecord.verifyIntro")}</p>
        <ol className="list-decimal pl-6 space-y-2">
          <li>
            {t("promptRecord.verifyDownload")}{" "}
            <a
              href={record.fileUrl}
              className="text-info hover:underline break-all"
            >
              {`templates/${record.hash}.txt`}
            </a>
          </li>
          <li>
            {t("promptRecord.verifyRun")}
            <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 text-xs font-mono">
              {`shasum -a 256 ${record.hash}.txt`}
            </pre>
          </li>
          <li>{t("promptRecord.verifyMatch")}</li>
        </ol>
      </section>
    </div>
  );
}
