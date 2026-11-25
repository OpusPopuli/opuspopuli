"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

/**
 * The release this bundle was built from.
 *
 * Supplied by the deploy workflow as the `frontend-v*` tag, so what a user
 * reads here matches what was tagged, deployed and can be rolled back to —
 * which is the point of showing it. Deliberately NOT the version in
 * package.json: that is 0.1.0, has never been bumped, and would tell a support
 * conversation nothing.
 *
 * Inlined at build time like every NEXT_PUBLIC_* value, so it is fixed for the
 * life of a bundle rather than read at runtime. Undefined in local dev and in
 * any build that did not come from the workflow — in which case nothing is
 * rendered, rather than a misleading placeholder.
 */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

export function Footer() {
  const { t } = useTranslation("common");
  return (
    <footer className="border-t border-line bg-surface">
      {/* Illustrative-purpose notice (#962): the platform is a civic-education
          tool built on public sources; summaries and data matches are
          automated and may be inaccurate. Site-wide safety net against
          misreading derived views (esp. campaign-finance attributions) as
          authoritative or as allegations. */}
      <div className="max-w-6xl mx-auto px-8 pt-6">
        <p className="text-sm leading-relaxed text-content-dim">
          {t("footer.notice")}
        </p>
      </div>
      <div className="max-w-6xl mx-auto px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-content-dim">
          &copy; {new Date().getFullYear()} Opus Populi. {t("footer.rights")}
          {APP_VERSION && (
            <>
              {" "}
              <span className="text-content-dim/70">
                &middot; <span translate="no">{APP_VERSION}</span>
              </span>
            </>
          )}
        </p>
        <nav className="flex items-center gap-6">
          <Link
            href="/privacy"
            className="text-sm text-content-dim hover:text-content"
          >
            {t("footer.privacyPolicy")}
          </Link>
          <Link
            href="/terms"
            className="text-sm text-content-dim hover:text-content"
          >
            {t("footer.termsOfService")}
          </Link>
          <Link
            href="/our-commitments"
            className="text-sm text-content-dim hover:text-content"
          >
            {t("footer.ourCommitments")}
          </Link>
          <Link
            href="/transparency"
            className="text-sm text-content-dim hover:text-content"
          >
            {t("footer.transparency")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
