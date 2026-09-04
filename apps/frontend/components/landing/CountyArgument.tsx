"use client";

import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import { STATEWIDE_INITIATIVE } from "@/lib/graphql/counties";

const STATUTE_URL =
  "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=ELEC&sectionNum=9118";

/**
 * The argument under the map, in the order the foundation makes it: why the
 * county is the scale, why a formal right was never enough, what we changed
 * instead, and how to check any of it.
 *
 * Each section carries the attribution for the claim it is making. The
 * philosophy lives on opuspopuli.org; these are pointers to it, not a
 * duplicate of it.
 */
export function CountyArgument() {
  const { t, i18n } = useTranslation("landing");
  const nf = new Intl.NumberFormat(i18n.language);

  return (
    <>
      <Section id="scale" heading={t("counties.scale.heading")}>
        <p>
          {t("counties.scale.body1", {
            statute: nf.format(STATEWIDE_INITIATIVE.statute),
            amendment: nf.format(STATEWIDE_INITIATIVE.constitutionalAmendment),
          })}
        </p>
        <p>{t("counties.scale.body2")}</p>
        <Cite>{t("counties.scale.cite")}</Cite>
      </Section>

      <Section id="fair" heading={t("counties.fair.heading")}>
        <p>{t("counties.fair.body1")}</p>
        <p>{t("counties.fair.body2")}</p>
        <Cite>{t("counties.fair.cite")}</Cite>
      </Section>

      <Section id="cost" heading={t("counties.cost.heading")}>
        <p>{t("counties.cost.body1")}</p>
        <p>{t("counties.cost.body2")}</p>
        <Cite>{t("counties.cost.cite")}</Cite>

        <dl className="mt-8 max-w-none">
          <Cost
            title={t("counties.cost.items.ballotTitle")}
            body={t("counties.cost.items.ballotBody")}
          />
          <Cost
            title={t("counties.cost.items.moneyTitle")}
            body={t("counties.cost.items.moneyBody")}
          />
          <Cost
            title={t("counties.cost.items.decidesTitle")}
            body={t("counties.cost.items.decidesBody")}
          />
          <Cost
            title={t("counties.cost.items.doTitle")}
            body={t("counties.cost.items.doBody")}
          />
        </dl>
      </Section>

      <Section id="check" heading={t("counties.check.heading")}>
        <p>{t("counties.check.body1")}</p>
        <p>{t("counties.check.body2")}</p>
        {/* The trust grid this replaces existed to carry these two links. The
            claim above is the one that earns them, so they live under it. */}
        <p className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/transparency">{t("counties.check.transparency")}</Link>
          <Link href="/privacy">{t("counties.check.privacy")}</Link>
        </p>
        <Cite>{t("counties.check.cite")}</Cite>
      </Section>

      <section
        className="mx-auto max-w-6xl border-t border-line px-8 py-14"
        aria-labelledby="footnote-heading"
      >
        <h2
          id="footnote-heading"
          className="text-sm font-semibold uppercase tracking-wide text-content-dim"
        >
          {t("counties.footnote.heading")}
        </h2>
        <ul className="mt-4 max-w-[63ch] space-y-2.5 text-sm text-content-dim">
          <li>
            {/* The statute is cited where the 10% figure is explained, and
                linked, because "trust us" is not what this page is for. */}
            <Trans
              i18nKey="counties.footnote.statute"
              ns="landing"
              components={[
                <a
                  key="statute"
                  href={STATUTE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />,
              ]}
            />
          </li>
          <li>{t("counties.footnote.notPassing")}</li>
          <li>{t("counties.footnote.cities")}</li>
          <li>{t("counties.footnote.cycle")}</li>
        </ul>
      </section>
    </>
  );
}

function Section({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="mx-auto max-w-6xl border-t border-line px-8 py-14"
      aria-labelledby={`${id}-heading`}
    >
      <h2
        id={`${id}-heading`}
        className="max-w-[26ch] text-balance font-serif text-3xl leading-tight text-content"
      >
        {heading}
      </h2>
      <div className="mt-5 max-w-[63ch] space-y-4 text-content-dim">
        {children}
      </div>
    </section>
  );
}

function Cite({ children }: { children: React.ReactNode }) {
  return <p className="text-sm italic">{children}</p>;
}

function Cost({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid gap-2 border-t border-line py-5 sm:grid-cols-[15ch_1fr] sm:gap-7">
      <dt className="font-serif text-xl text-content">{title}</dt>
      <dd className="max-w-[58ch] text-content-dim">{body}</dd>
    </div>
  );
}
