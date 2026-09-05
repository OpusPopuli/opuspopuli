"use client";

import { useTranslation } from "react-i18next";

type Readiness = "live" | "building";

/**
 * What the account actually gets, and what it does not get yet.
 *
 * This replaces four consecutive slides — Explore Your Region, Scan Petitions,
 * Instant Analysis, Track Progress — that advertised capabilities in the
 * present tense before the reader had been asked a single question. Two of
 * them described work still in progress.
 *
 * The Live / Building split costs one word per row and buys the credibility
 * the rest of the flow spends. A reader who finds the gap later, by its
 * absence, reads it as a broken product; a reader told up front reads it as an
 * honest one.
 */
const CAPABILITIES: { key: string; readiness: Readiness }[] = [
  { key: "threshold", readiness: "live" },
  { key: "propositions", readiness: "live" },
  // Bills sits directly after propositions and before finance because it is
  // where the topics step two screens earlier pays off. A reader who picked
  // three issues should be told, in one line, what picking them did.
  { key: "bills", readiness: "live" },
  { key: "committees", readiness: "live" },
  { key: "finance", readiness: "live" },
  { key: "representatives", readiness: "live" },
  { key: "countyMeasures", readiness: "building" },
  { key: "petitions", readiness: "building" },
];

export function ExpectationsStep({
  onComplete,
}: {
  readonly onComplete: () => void;
}) {
  const { t } = useTranslation("onboarding");

  return (
    <div className="w-full max-w-md">
      <p className="text-xs font-semibold uppercase tracking-[0.13em] text-content-dim">
        {t("progress.stepOf", { current: 5, total: 6 })}
      </p>
      <h2 className="mt-3 font-serif text-3xl leading-tight text-content">
        {t("expectations.title")}
      </h2>
      <p className="mt-3 text-content-dim">{t("expectations.body")}</p>

      <ul className="mt-6">
        {CAPABILITIES.map(({ key, readiness }) => (
          <li
            key={key}
            className="flex gap-4 border-t border-line py-3 last:border-b"
          >
            <ReadinessTag readiness={readiness} />
            <div>
              <p className="font-semibold text-content">
                {t(`expectations.items.${key}.title`)}
              </p>
              <p className="mt-0.5 text-sm text-content-dim">
                {t(`expectations.items.${key}.body`)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-sm text-content-dim">
        <strong className="font-semibold text-content">
          {t("expectations.notifyLead")}
        </strong>{" "}
        {t("expectations.notifyBody")}
      </p>

      <div className="flex justify-end pt-6">
        <button
          type="button"
          onClick={onComplete}
          className="rounded-full bg-inverse-surface px-8 py-3 font-semibold text-on-inverse transition-colors hover:opacity-90"
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}

/**
 * The readiness word, as text.
 *
 * Deliberately not a colour-only badge: "still being built" is the single most
 * important thing on this screen for a reader deciding whether to trust it, so
 * it cannot be carried by hue alone (WCAG 1.4.1).
 */
function ReadinessTag({ readiness }: { readiness: Readiness }) {
  const { t } = useTranslation("onboarding");
  const live = readiness === "live";
  return (
    <span
      className={[
        "mt-0.5 h-fit shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        live
          ? "bg-positive-surface text-positive"
          : "bg-surface-sunk text-content-dim",
      ].join(" ")}
    >
      {t(`expectations.readiness.${readiness}`)}
    </span>
  );
}
