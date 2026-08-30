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
     * The copy has to be true from both sides. For someone holding a genuine
     * county petition it must not read as an accusation; for someone holding a
     * fake it must not read as reassurance.
     */
    it("says we could not match it AND that it may be legitimate", () => {
      render(<VerificationBanner verificationState="unverified" />);

      const body = screen.getByText(/We couldn't match this/);
      expect(body).toBeInTheDocument();
      // Neither half alone is honest.
      expect(body).toHaveTextContent(/local or county petition/);
      expect(body).toHaveTextContent(/may not be on file/);
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
        name: /Not matched to a filed state measure/,
      }),
    ).toBeInTheDocument();
  });
});
