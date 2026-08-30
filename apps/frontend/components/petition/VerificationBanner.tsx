"use client";

import { useTranslation } from "react-i18next";

/**
 * Says which of two things the reader is looking at (#1074): an analysis
 * grounded in the filed record, or a reading of the photograph alone.
 *
 * Rendered ALONGSIDE the analysis, not instead of it — unlike `NotAPetition`,
 * which replaces it. Both states still carry a full analysis; what differs is
 * what backs it.
 *
 * ── Why `unverified` is worded the way it is ────────────────────────────────
 *
 * Retrieval cannot separate a real local or county measure from a fabricated
 * sheet. Both are simply absent from the corpus, which holds state filings
 * only. So this is **disclosure, not detection**: it reports what we checked,
 * never what we concluded about legitimacy.
 *
 * That constrains the copy from both sides. It must be true for someone
 * holding a genuine county petition — for whom "we couldn't verify this" must
 * not sound like an accusation — and equally true for someone holding a fake,
 * for whom it must not sound like reassurance. "We may not have it on file"
 * alone fails the second test; "we could not verify this" alone fails the
 * first. Hence both halves, and the closing clause that says plainly what we
 * actually read.
 *
 * Deliberately NOT styled as an error or a warning. A local measure with no
 * state filing is the normal case for a whole class of real petitions, and
 * colouring it as a problem would tell that user something false.
 */
export function VerificationBanner({
  verificationState,
  matchedExternalId,
}: Readonly<{
  verificationState?: string;
  matchedExternalId?: string;
}>) {
  const { t } = useTranslation("petition");

  // Absent on analyses produced before retrieval existed, and on non-petition
  // types. Render nothing rather than guessing at provenance we do not have.
  if (verificationState !== "verified" && verificationState !== "unverified") {
    return null;
  }

  const verified = verificationState === "verified";

  return (
    <section
      aria-labelledby="verification-title"
      data-testid={`verification-${verificationState}`}
      className={`mx-4 mb-4 rounded-lg border px-4 py-3 ${
        verified ? "border-positive-line bg-positive-surface" : "border-line"
      }`}
    >
      <h2
        id="verification-title"
        className={`text-sm font-semibold ${
          verified ? "text-positive" : "text-content"
        }`}
      >
        {verified
          ? t("verification.verifiedTitle")
          : t("verification.unverifiedTitle")}
      </h2>
      <p className="mt-1 text-sm leading-snug text-content-dim">
        {verified
          ? t("verification.verifiedBody", {
              // The AG number is the filing's identity and the thing a reader
              // can check for themselves on the Secretary of State's site.
              measure: matchedExternalId ?? "",
            })
          : t("verification.unverifiedBody")}
      </p>
    </section>
  );
}
