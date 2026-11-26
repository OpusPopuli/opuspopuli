"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import {
  dismissedServerSnapshot,
  dismissedSnapshot,
  isDismissed,
  noDismissalSubscription,
  rememberDismissed,
} from "@/lib/device-dismissals";

const NAME = "reading-notice";

/**
 * "How to read this site", shown once (#962, #1456).
 *
 * The civic record is now open to anyone arriving from a search result, so
 * the first page they land on says, before anything else, what kind of
 * record this is: public sources, AI summaries that are labelled and may be
 * wrong, and links between people and money that are automated rather than
 * allegations. Dismissed once, it's remembered on the device; the footer
 * carries the same notice on every page.
 *
 * Inline, never a modal: it mustn't stand between a reader and the record.
 */
export function ReadingNotice() {
  const { t } = useTranslation("common");
  const stored = useSyncExternalStore(
    noDismissalSubscription,
    dismissedSnapshot,
    dismissedServerSnapshot,
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  if (stored === null || isDismissed(stored, NAME) || dismissedNow) {
    return null;
  }

  return (
    <aside
      aria-labelledby="reading-notice-title"
      className="border-b border-line bg-surface-alt"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-8 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-sm">
          <h2 id="reading-notice-title" className="font-semibold text-content">
            {t("readingNotice.title")}
          </h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-content-dim">
            <li>{t("readingNotice.sources")}</li>
            <li>{t("readingNotice.ai")}</li>
            <li>{t("readingNotice.links")}</li>
          </ul>
          <Link
            href="/region/how-it-works"
            className="mt-1 inline-block text-content underline decoration-line underline-offset-2 hover:decoration-accent"
          >
            {t("readingNotice.more")}
          </Link>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => {
            rememberDismissed(NAME);
            setDismissedNow(true);
          }}
        >
          {t("readingNotice.dismiss")}
        </Button>
      </div>
    </aside>
  );
}
