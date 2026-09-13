import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VerificationBanner } from "@/components/petition/VerificationBanner";

/**
 * The provenance label (#1074).
 *
 * This is the deliverable of the whole issue, not decoration. Retrieval cannot
 * separate a real local or county measure from a fabricated sheet — both are
 * absent from a corpus that holds state filings only — so the refusal path was
 * dropped and the label carries the entire weight of the honesty claim.
 */
describe("VerificationBanner", () => {
  describe("verified", () => {
    it("names the filing the analysis is based on", () => {
      render(
        <VerificationBanner
          verificationState="verified"
          matchedExternalId="25-0007A1"
        />,
      );

      expect(
        screen.getByText(/Verified against the filed record/),
      ).toBeInTheDocument();
      // The AG number is what a reader can check for themselves.
      expect(screen.getByText(/25-0007A1/)).toBeInTheDocument();
    });
  });

  describe("unverified", () => {
    /**
     * The copy has to be true from three sides now, not two.
     *
     * For someone holding a genuine county petition it must not read as an
     * accusation; for someone holding a fake it must not read as reassurance;
     * and since #1156 it must also be true when we DID match the petition but
     * declined to vouch for the match, because the similarity threshold
     * belongs to a model that is no longer selectable (#1233).
     *
     * The previous copy — "We couldn't match this to a filed state measure …
     * it may not be on file" — is false in that third case: we matched it,
     * possibly correctly at high similarity, and it is on file. This asserts
     * the claim that replaced it, which is true in all three.
     */
    it("does not claim we failed to find a match", () => {
      render(<VerificationBanner verificationState="unverified" />);

      const body = screen.getByText(/We haven't confirmed which filed measure/);
      expect(body).toBeInTheDocument();
      // Still offers the innocent explanations — neither half alone is honest.
      expect(body).toHaveTextContent(/local or county petition/);
      expect(body).toHaveTextContent(/may not be on file/);
      // ...and the case that used to be unrepresentable.
      expect(body).toHaveTextContent(
        /not have matched it with enough confidence/,
      );
    });

    /** What we actually read, stated plainly rather than implied. */
    it("states that it read the page, not an official record", () => {
      render(<VerificationBanner verificationState="unverified" />);

      expect(
        screen.getByText(
          /reading the page in front of you, not an official record/,
        ),
      ).toBeInTheDocument();
    });

    /**
     * A local measure with no state filing is the normal case for a whole
     * class of real petitions. Colouring it as an error would tell that user
     * something false.
     */
    it("is not styled as an error or warning", () => {
      const { container } = render(
        <VerificationBanner verificationState="unverified" />,
      );

      const banner = container.querySelector(
        '[data-testid="verification-unverified"]',
      )!;
      expect(banner.className).not.toMatch(/negative|warning|danger|error/);
    });

    it("never claims a match it does not have", () => {
      render(<VerificationBanner verificationState="unverified" />);

      expect(screen.queryByText(/Verified against/)).not.toBeInTheDocument();
    });
  });

  /**
   * Absent on analyses produced before retrieval existed, and on non-petition
   * types. Rendering a default state would assert provenance we do not have.
   */
  it.each([
    ["no state", undefined],
    ["an unrecognised state", "something_else"],
  ])("renders nothing for %s", (_label, state) => {
    const { container } = render(
      <VerificationBanner verificationState={state} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("is reachable as a labelled region", () => {
    render(<VerificationBanner verificationState="unverified" />);

    expect(
      screen.getByRole("region", {
        name: /Not confirmed against the filed record/,
      }),
    ).toBeInTheDocument();
  });
});
