import { render, screen } from "@testing-library/react";

import { FundingBasisNote } from "@/components/region/FundingBasisNote";
import type { FundingBasis } from "@/lib/graphql/region";

/**
 * The disclosure half of #991.
 *
 * Admitting 9,044,935 previously-rejected expenditure rows moves $11.87B into
 * the totals on this site. That is only defensible if the page says which
 * parts of a figure it cannot describe — so these tests assert the wording
 * carries quantities, and that the three kinds of uncertainty stay apart.
 */
const clean: FundingBasis = {
  undatedAmount: 0,
  undatedCount: 0,
  unattributedAmount: 0,
  unattributedCount: 0,
  unitemizedAmount: 0,
  reconciledFilings: 12,
  asOfSource: "2026-10-12T08:52:56Z",
  measured: true,
};

const renderNote = (
  basis: FundingBasis | null | undefined,
  totals: {
    totalRaised?: number;
    totalSpent?: number;
    unitemizedBase?: number;
  } = {},
) =>
  render(
    <FundingBasisNote
      basis={basis}
      totalRaised={totals.totalRaised ?? 1_000_000}
      totalSpent={totals.totalSpent ?? 800_000}
      unitemizedBase={totals.unitemizedBase ?? totals.totalRaised ?? 1_000_000}
    />,
  );

const noteText = () => screen.getByRole("note").textContent ?? "";

describe("FundingBasisNote (#991)", () => {
  it("names the undated quantity, its total and its share", () => {
    renderNote(
      { ...clean, undatedAmount: 200_000, undatedCount: 1_412 },
      { totalSpent: 800_000 },
    );

    const text = noteText();
    // Rule 2: a reader must be able to act on the number. "$200,000 of the
    // $800,000 spent (25.0%)" is a disclosure; "may be incomplete" is not.
    expect(text).toContain("$200,000");
    expect(text).toContain("$800,000");
    expect(text).toContain("25.0%");
    expect(text).toContain("1,412 payments");
    // Rule 3, the half readers get wrong: this money IS in the total.
    expect(text).toContain("counted in the total");
  });

  it("uses the singular when exactly one payment is undated", () => {
    renderNote({ ...clean, undatedAmount: 50, undatedCount: 1 });
    expect(noteText()).toContain("1 payment.");
  });

  it("says the undated and unattributed amounts do not add together", () => {
    renderNote({
      ...clean,
      undatedAmount: 200_000,
      undatedCount: 10,
      unattributedAmount: 100_000,
      unattributedCount: 5,
    });

    // They overlap — a row missing both is counted in each — so a reader who
    // sums them gets a number describing nothing.
    expect(noteText()).toContain("do not add together");
  });

  it("omits the overlap caveat when only one of the two is present", () => {
    renderNote({ ...clean, undatedAmount: 200_000, undatedCount: 10 });
    expect(noteText()).not.toContain("do not add together");
  });

  it("states unitemized money is NOT in the raised total, over the reported total", () => {
    renderNote(
      { ...clean, unitemizedAmount: 250_000 },
      { totalRaised: 750_000 },
    );

    const text = noteText();
    expect(text).toContain("$250,000");
    // The denominator is what was REPORTED raised — stored ($750k) plus the
    // unitemized ($250k). Dividing by the stored total alone would print
    // 33.3% and overstate our own coverage.
    expect(text).toContain("$1,000,000");
    expect(text).toContain("25.0%");
    expect(text).toContain("NOT included in the raised total");
  });

  it("states each dimension affirmatively rather than going silent", () => {
    renderNote(clean);

    const text = noteText();
    // "Nothing is undated" and "nobody checked" must not look identical, so
    // a clean result still says so — once per dimension, scoped to what we
    // hold, and never asserting the SOURCE was complete.
    expect(text).toContain("No expenditure on file is missing");
    expect(text).toContain("All 12 filings reconciled here");
    expect(text).toContain("not a guarantee that the source export");
  });

  it("will not claim contributions are itemized when nothing was reconciled", () => {
    // `unitemizedAmount: 0` with `reconciledFilings: 0` is "never checked",
    // not "nothing hidden" — the reconciliation pass simply has not run for
    // this committee. Claiming the good reading would be an invention.
    renderNote({ ...clean, reconciledFilings: 0 });

    const text = noteText();
    expect(text).toContain("has been checked against its own summary totals");
    expect(text).not.toContain("reported their contributions in itemized");
  });

  it("treats a missing reconciled count as unknown, not as good news", () => {
    // An older cached response has no `reconciledFilings` at all.
    const withoutCount: FundingBasis = { ...clean };
    delete withoutCount.reconciledFilings;
    renderNote(withoutCount);

    expect(noteText()).toContain("has been checked against its own summary");
  });

  it("never asserts the source export was complete", () => {
    // The trap this replaced: the corpus on hand was ingested under the
    // schema that REJECTED blank-date rows, so every stored row has a date.
    // "Nothing is undated" is true of our database and a false impression of
    // CAL-ACCESS. Gating on `asOfSource` did not help — a snapshot row says
    // nothing about which schema ingested the rows. Every claim is scoped to
    // the records on file instead.
    renderNote(clean);

    const text = noteText();
    expect(text).toContain("describe the records on file");
    expect(text).toContain("not a guarantee");
  });

  it("dates the figures to the source export", () => {
    renderNote(clean);
    expect(noteText()).toContain("Oct 12, 2026");
  });

  it("says the export is unrecorded rather than inventing a date", () => {
    renderNote({ ...clean, asOfSource: null });

    const text = noteText();
    // Covers both ways the source can be unknowable: never recorded, and
    // ambiguous between several `campaign_finance` exports.
    expect(text).toContain("cannot be tied to a single bulk export");
    // `new Date(null)` is the epoch; a date formatter would render this.
    expect(text).not.toContain("1970");
  });

  it("states the basis is unknown when the field is absent, and shows no total as sound", () => {
    // Apollo persists to IndexedDB, so a response cached before this field
    // existed can reach a live page. It must not crash, and it must not
    // present the total as fully described.
    renderNote(undefined);

    const text = noteText();
    expect(text).toContain("could not be determined");
    expect(text).not.toContain("No expenditure on file is missing");
  });

  it("will not render unmeasured zeros as an all-clear", () => {
    // The backend's FundingBasisService is injected @Optional(). Dropped from
    // the module in a refactor, it returns the all-zero fallback with no throw
    // and no log — and without `measured` this page would tell anonymous
    // readers that every expenditure carries a date and payee, about $11.87B
    // nobody measured, cached for four hours.
    renderNote({ ...clean, measured: false });

    const text = noteText();
    expect(text).toContain("could not be determined");
    expect(text).not.toContain("No expenditure on file is missing");
    expect(text).not.toContain("itemized detail");
  });

  it("drops the unitemized share when no sound denominator exists", () => {
    // The proposition surface passes no base: its `totalRaised` mixes
    // committee contributions with independent-expenditure SPENDING, and
    // `unitemizedAmount` is a contributions-only residual. The dollars still
    // show; the share is not invented from two populations.
    render(
      <FundingBasisNote
        basis={{ ...clean, unitemizedAmount: 250_000 }}
        totalRaised={0}
        totalSpent={800_000}
      />,
    );

    const text = noteText();
    expect(text).toContain("$250,000");
    expect(text).toContain("NOT included in the raised total");
    expect(text).not.toContain("%)");
  });

  it("drops the share rather than printing NaN% when the total is zero", () => {
    renderNote(
      { ...clean, undatedAmount: 500, undatedCount: 2 },
      { totalSpent: 0 },
    );

    const text = noteText();
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("%)");
  });

  it("drops a share that would exceed 100%", () => {
    // `amount` is a SIGNED decimal — CAL-ACCESS files negatives for refunds
    // and corrections, so dated rows can sum below zero and leave an undated
    // subtotal larger than the whole. "(1000.0%)" would be faithful and
    // useless; the dollar figures stay exact.
    renderNote(
      { ...clean, undatedAmount: 1_000, undatedCount: 3 },
      { totalSpent: 100 },
    );

    const text = noteText();
    expect(text).toContain("$1,000");
    expect(text).not.toContain("%)");
  });
});
