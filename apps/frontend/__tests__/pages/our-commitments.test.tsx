/**
 * /our-commitments page (#754).
 *
 * Pins down the binding-text contract the issue cares about: the page
 * renders all ten commitments verbatim, surfaces the current version
 * + last-updated date, links into the Terms of Service for the
 * incorporation clause, and lists the version history.
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import OurCommitmentsPage from "@/app/our-commitments/page";
import {
  COMMITMENTS_HISTORY,
  COMMITMENTS_LAST_UPDATED,
  COMMITMENTS_VERSION,
  COMMITMENT_SLUGS,
} from "@/lib/commitments";

// next/link is a server primitive in App Router — stub for the
// component test so we don't need a full Next.js test harness. The
// data-href attribute keeps the link assertions readable.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...rest
  }: React.PropsWithChildren<{
    href: string;
  }>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Header + Footer pull in next/navigation hooks which jsdom can't
// satisfy — stub to the minimum needed to render the main column.
jest.mock("@/components/Header", () => ({ Header: () => <header /> }));
jest.mock("@/components/Footer", () => ({ Footer: () => <footer /> }));

describe("/our-commitments page", () => {
  it("renders the page heading", () => {
    render(<OurCommitmentsPage />);

    expect(
      screen.getByRole("heading", {
        name: /our public commitments/i,
        level: 1,
      }),
    ).toBeInTheDocument();
  });

  it("shows the current version and last-updated date", () => {
    render(<OurCommitmentsPage />);

    const versionLine = screen.getByTestId("commitments-version-line");
    expect(versionLine).toHaveTextContent(COMMITMENTS_VERSION);
    expect(versionLine).toHaveTextContent(COMMITMENTS_LAST_UPDATED);
  });

  it("renders all ten commitments as discoverable list items", () => {
    render(<OurCommitmentsPage />);

    for (const slug of COMMITMENT_SLUGS) {
      expect(screen.getByTestId(`commitment-${slug}`)).toBeInTheDocument();
    }
  });

  it("links into the Terms of Service for the incorporation clause", () => {
    render(<OurCommitmentsPage />);

    const termsLink = screen.getByRole("link", { name: /terms of service/i });
    expect(termsLink).toHaveAttribute("href", "/terms");
  });

  it("exposes mailto links for legal + security contact", () => {
    render(<OurCommitmentsPage />);

    expect(
      screen.getByRole("link", { name: /legal@opuspopuli\.org/ }),
    ).toHaveAttribute("href", "mailto:legal@opuspopuli.org");
    expect(
      screen.getByRole("link", { name: /security@opuspopuli\.org/ }),
    ).toHaveAttribute("href", "mailto:security@opuspopuli.org");
  });

  it("lists every published version in the history section", () => {
    render(<OurCommitmentsPage />);

    for (const entry of COMMITMENTS_HISTORY) {
      expect(
        screen.getByText(new RegExp(`v${entry.version}`)),
      ).toBeInTheDocument();
    }
  });
});
