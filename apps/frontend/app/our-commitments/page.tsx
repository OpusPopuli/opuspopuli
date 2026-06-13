"use client";

import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  COMMITMENTS_HISTORY,
  COMMITMENTS_LAST_UPDATED,
  COMMITMENTS_VERSION,
  COMMITMENT_SLUGS,
} from "@/lib/commitments";
import "@/lib/i18n";

export default function OurCommitmentsPage() {
  const { t } = useTranslation("commitments");
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <main
        id="commitments-content"
        className="flex-1 max-w-3xl mx-auto px-8 py-12 print:py-0 print:max-w-none"
        data-testid="commitments-page"
      >
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t("page.title")}
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            {t("page.subtitle")}
          </p>
          <p
            className="mt-3 text-sm text-gray-500 dark:text-gray-400"
            data-testid="commitments-version-line"
          >
            <span>
              {t("page.versionLabel", { version: COMMITMENTS_VERSION })}
            </span>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            <time dateTime={COMMITMENTS_LAST_UPDATED}>
              {t("page.lastUpdatedLabel", {
                date: COMMITMENTS_LAST_UPDATED,
              })}
            </time>
          </p>
        </header>

        <section aria-labelledby="commitments-intro" className="mb-10">
          <h2
            id="commitments-intro"
            className="text-xl font-semibold text-gray-900 dark:text-white mb-3"
          >
            {t("intro.heading")}
          </h2>
          <p className="text-gray-700 dark:text-gray-300">{t("intro.body")}</p>
        </section>

        <section aria-label={t("page.title")} className="mb-10">
          <ol className="space-y-6 list-none p-0">
            {COMMITMENT_SLUGS.map((slug, index) => (
              <li
                key={slug}
                id={slug}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
                data-testid={`commitment-${slug}`}
              >
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  <span
                    className="inline-block w-7 text-[#5A7A6A] dark:text-sage-300"
                    aria-hidden="true"
                  >
                    {index + 1}.
                  </span>
                  {t(`commitments.${slug}.title`)}
                </h3>
                <p className="text-gray-700 dark:text-gray-300 pl-7">
                  {t(`commitments.${slug}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="commitments-incorporation"
          className="mb-10 rounded-lg border border-sage-200 dark:border-sage-700 bg-sage-50 dark:bg-sage-900/20 p-6"
        >
          <h2
            id="commitments-incorporation"
            className="text-xl font-semibold text-gray-900 dark:text-white mb-3"
          >
            {t("incorporation.heading")}
          </h2>
          <p className="text-gray-700 dark:text-gray-300">
            <Trans
              i18nKey="incorporation.body"
              t={t}
              components={{
                termsLink: (
                  <Link
                    href="/terms"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </section>

        <section aria-labelledby="commitments-history" className="mb-10">
          <h2
            id="commitments-history"
            className="text-xl font-semibold text-gray-900 dark:text-white mb-2"
          >
            {t("history.heading")}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {t("history.subhead")}
          </p>
          <ul className="space-y-2">
            {COMMITMENTS_HISTORY.map((entry) => (
              <li
                key={entry.version}
                className="text-sm text-gray-700 dark:text-gray-300"
              >
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400 mr-2">
                  v{entry.version} · {entry.date}
                </span>
                {t(`history.${entry.summaryKey}`)}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="commitments-contact" className="mb-10">
          <h2
            id="commitments-contact"
            className="text-xl font-semibold text-gray-900 dark:text-white mb-3"
          >
            {t("contact.heading")}
          </h2>
          <p className="text-gray-700 dark:text-gray-300">
            <Trans
              i18nKey="contact.body"
              t={t}
              components={{
                emailLink: (
                  <a
                    href="mailto:legal@opuspopuli.org"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  />
                ),
                securityEmailLink: (
                  <a
                    href="mailto:security@opuspopuli.org"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
