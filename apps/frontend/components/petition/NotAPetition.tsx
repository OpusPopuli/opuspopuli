"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

/**
 * Honest rejection state for the scan results (#1057): the classifier (or
 * the minimum-text pre-gate) determined the scanned document is not
 * analyzable as a petition. Rendered INSTEAD of the analysis — never both.
 *
 * Two variants keyed by the closed skipReason enum:
 *  - not_a_petition: "this looks like something else" + rescan CTA
 *  - unreadable: "we couldn't read enough text" + rescan CTA (better photo)
 *
 * The report-issue affordance on the page stays available as the
 * false-negative escape hatch. Fixed/on-token rules for the petition
 * pinned-dark surface per #1047/#1055.
 */
export function NotAPetition({
  skipReason,
}: Readonly<{ skipReason?: string }>) {
  const { t } = useTranslation("petition");
  const router = useRouter();

  const variant = skipReason === "unreadable" ? "unreadable" : "notAPetition";

  return (
    <section
      aria-labelledby="not-a-petition-title"
      className="flex flex-col items-center px-6 py-12 text-center"
    >
      <svg
        className="mb-4 h-16 w-16 text-content-dim"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9.879 9.879A3 3 0 0114.12 14.12M9.88 9.88l4.242 4.242M9.88 9.88L5.636 5.636m8.485 8.485l4.243 4.243M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <h2
        id="not-a-petition-title"
        className="mb-2 text-xl font-semibold text-paper"
      >
        {t(`results.${variant}Title`)}
      </h2>
      <p className="mb-6 max-w-md text-content-dim">
        {t(`results.${variant}Body`)}
      </p>
      <button
        onClick={() => router.push("/petition/capture")}
        className="rounded-lg bg-accent px-6 py-3 font-medium text-on-accent transition-colors hover:bg-accent-strong"
      >
        {t("results.tryAgain")}
      </button>
    </section>
  );
}
