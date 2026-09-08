"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

/**
 * Escape hatch under a list-page search box.
 *
 * A reader who filters Bills for "leaf blower", finds nothing, and
 * concludes the platform holds no leaf-blower ordinance has been misled
 * by scope they never chose — the ordinance is a county record, not a
 * bill. Absence must be stated, not implied (search-surface-direction
 * §2, §5), and this line is what states it.
 */
export function SearchEverythingHint() {
  const { t } = useTranslation("region");
  return (
    <p className="mb-6 text-sm text-content-dim">
      {t("search.outsideList")}{" "}
      <Link
        // prefetch-ok: one link, and it is the affordance's whole point
        href="/region/search"
        className="text-content underline decoration-line underline-offset-2"
      >
        {t("search.searchEverything")}
      </Link>
    </p>
  );
}
