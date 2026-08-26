"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Sunflower } from "@/components/brand";
import { ActivityFeed } from "@/components/petition/ActivityFeed";

export default function PetitionPage() {
  const { t } = useTranslation("petition");

  return (
    // Scroll WITHIN the layout's fixed black box (like the results page). With
    // min-h-full alone, tall content overflowed the fixed inset-0 box onto the
    // light <body>, dropping the footer link onto a light surface and failing
    // WCAG contrast (the a11y E2E caught it).
    <div className="h-full overflow-y-auto text-paper">
      <div className="flex min-h-full flex-col items-center px-6 py-12 text-center">
        <div className="flex flex-1 flex-col items-center justify-center">
          <Sunflower state="idle" size={56} title="Opus Populi" />

          <h1 className="font-display mt-6 text-3xl font-bold leading-tight text-paper text-balance">
            {t("home.title")}
          </h1>
          <p className="mt-3 max-w-sm text-content-dim leading-relaxed">
            {t("home.description")}
          </p>

          <Link
            href="/petition/capture"
            className="mt-8 inline-flex w-full max-w-xs items-center justify-center gap-2.5 rounded-xl bg-accent px-8 py-3.5 font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
              />
            </svg>
            {t("home.startScanning")}
          </Link>

          <div className="mt-4 flex items-center gap-2">
            <Link
              href="/settings/scans"
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-content-dim transition-colors hover:border-accent hover:text-content"
            >
              {t("home.myScans")}
            </Link>
            <Link
              href="/petition/map"
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-content-dim transition-colors hover:border-accent hover:text-content"
            >
              {t("home.viewMap")}
            </Link>
          </div>
        </div>

        <div className="mt-10 w-full max-w-sm">
          <ActivityFeed />
        </div>

        <Link
          href="/"
          className="mt-8 text-sm text-content-dim transition-colors hover:text-content"
        >
          {t("home.backToHome")}
        </Link>
      </div>
    </div>
  );
}
