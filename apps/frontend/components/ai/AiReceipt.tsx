"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AiProvenance } from "@/lib/graphql/region";

/**
 * "How this was made" — the receipt under a generated passage (#1450).
 *
 * Shows what made the text, what it read, which model and which exact
 * prompt, and when. Two rules carry the whole design:
 *
 *  - A field the row did not record reads "Not recorded". It is never
 *    hidden: a receipt that quietly drops its gaps reads as complete.
 *  - It shows only what the backend could prove of THIS output — the
 *    backend omits a source the text was not made from — and adds nothing.
 *    Where the text was made from our own records rather than a document,
 *    the page says so through `madeFrom`.
 *
 * The prompt links to `/transparency/prompts/<hash>`, which resolves the
 * hash against prompt-service's public attestation record.
 */
export function AiReceipt({
  provenance,
  madeFrom,
  sourceRefLabel,
}: {
  readonly provenance?: AiProvenance | null;
  /**
   * What the text was made from when there is no document to link, already
   * translated — e.g. "Our record of this member". Ignored when the
   * receipt names a source.
   */
  readonly madeFrom?: string;
  /**
   * How to describe `sourceRef` to a reader, already translated and
   * including the ref — an export version id means nothing on its own.
   */
  readonly sourceRefLabel?: string;
}) {
  const { t, i18n } = useTranslation("common");
  if (!provenance) return null;

  const date = (iso?: string | null): string | null => {
    const when = iso ? new Date(iso) : null;
    if (!when || Number.isNaN(when.getTime())) return null;
    return new Intl.DateTimeFormat(i18n.language || "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(when);
  };

  // UNKNOWN shows every row as "Not recorded" rather than hiding them: the
  // reader should see what is missing, not a shorter receipt.
  const showModelRows =
    provenance.kind === "AI" || provenance.kind === "UNKNOWN";
  const hasDate = showModelRows || provenance.kind === "DETERMINISTIC";

  return (
    <details className="mt-3 text-[11px] text-content-dim">
      <summary className="cursor-pointer font-medium hover:text-content">
        {t("aiReceipt.summary")}
      </summary>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <Row label={t("aiReceipt.labels.origin")}>
          {t(`aiReceipt.origin.${provenance.kind}`)}
        </Row>
        <Row label={t("aiReceipt.labels.source")}>
          <Source
            provenance={provenance}
            madeFrom={madeFrom}
            sourceRefLabel={sourceRefLabel}
            retrieved={date(provenance.sourceFetchedAt)}
          />
        </Row>
        {showModelRows && (
          <>
            <Row label={t("aiReceipt.labels.model")}>
              <Model provenance={provenance} />
            </Row>
            <Row label={t("aiReceipt.labels.prompt")}>
              <Prompt provenance={provenance} />
            </Row>
          </>
        )}
        {hasDate && (
          <Row label={t("aiReceipt.labels.generated")}>
            {date(provenance.generatedAt) ?? <NotRecorded />}
          </Row>
        )}
      </dl>
    </details>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <dt className="font-medium">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function NotRecorded() {
  const { t } = useTranslation("common");
  return <span className="italic">{t("aiReceipt.notRecorded")}</span>;
}

function Source({
  provenance,
  madeFrom,
  sourceRefLabel,
  retrieved,
}: {
  readonly provenance: AiProvenance;
  readonly madeFrom?: string;
  readonly sourceRefLabel?: string;
  readonly retrieved: string | null;
}) {
  const { t } = useTranslation("common");
  const when = retrieved
    ? ` (${t("aiReceipt.retrieved", { date: retrieved })})`
    : "";

  const web = webUrl(provenance.sourceUrl);
  if (web) {
    return (
      <>
        <a
          href={web.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-info hover:text-info-strong underline break-all"
        >
          {displayUrl(web)}
          <span className="sr-only"> {t("aiReceipt.newTab")}</span>
        </a>
        {when}
      </>
    );
  }
  if (provenance.sourceRef) {
    const label =
      sourceRefLabel ?? t("aiReceipt.sourceRef", { ref: provenance.sourceRef });
    return <>{label + when}</>;
  }
  if (madeFrom) return <>{madeFrom}</>;
  return <NotRecorded />;
}

function Model({ provenance }: { readonly provenance: AiProvenance }) {
  const { t } = useTranslation("common");
  if (!provenance.llmModel) return <NotRecorded />;
  return (
    <>
      {provenance.llmModel}
      {provenance.llmDigest && (
        <span className="block font-mono text-[10px] break-all">
          {t("aiReceipt.exactBuild", { digest: provenance.llmDigest })}
        </span>
      )}
    </>
  );
}

function Prompt({ provenance }: { readonly provenance: AiProvenance }) {
  const { t } = useTranslation("common");
  const hash = provenance.promptHash;
  if (!hash) return <NotRecorded />;
  const short = hash.slice(0, 8);
  return (
    // No aria-label: it would replace the visible text, and a voice user
    // saying what they see must hit the link (WCAG 2.5.3). The explanation
    // is added for screen readers in front of the visible text instead.
    <Link
      href={`/transparency/prompts/${hash}`}
      // A page can hold several receipts; none should prefetch (#1174).
      prefetch={false}
      className="text-info hover:text-info-strong underline font-mono"
    >
      <span className="sr-only">{t("aiReceipt.promptLinkLabel")} </span>
      {provenance.promptVersion
        ? t("aiReceipt.promptLink", {
            version: provenance.promptVersion,
            hash: short,
          })
        : short}
    </Link>
  );
}

/**
 * A path a reader can read; left encoded if it cannot be decoded. Invisible
 * format characters (bidi overrides and the like) are removed, so decoded
 * text cannot disguise where a link goes.
 */
const INVISIBLE_FORMAT =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function readablePath(path: string): string {
  try {
    return decodeURIComponent(path).replace(INVISIBLE_FORMAT, "");
  } catch {
    return path;
  }
}

/**
 * The link text: site and path, shortened. The site alone is not enough —
 * a civics page lists several sources on the same site, and five links all
 * reading "sos.ca.gov" cannot be told apart.
 */
function displayUrl(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname === "/" ? "" : readablePath(url.pathname);
  const full = host + path;
  if (full.length <= 60) return full;
  // Keep the end: pages on one site differ in their last segment, so
  // "sos.ca.gov/…/referendum" tells two sources apart where a cut-off
  // "sos.ca.gov/elections/ballot-measures/initiative-and-ref…" does not.
  const last = path.split("/").filter(Boolean).pop() ?? "";
  const tail = last.length > 40 ? `${last.slice(0, 39)}…` : last;
  return `${host}/…/${tail}`;
}

/**
 * A source we will link to: http(s) only. Anything else — a malformed value,
 * `data:`, `mailto:` — is not offered as a link; the row then falls through
 * to the next description, and at worst reads "Not recorded".
 */
function webUrl(url?: string | null): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}
