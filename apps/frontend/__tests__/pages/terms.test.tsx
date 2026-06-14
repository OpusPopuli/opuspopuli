import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock the Header and Footer components
jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

import TermsOfServicePage from "@/app/terms/page";

describe("TermsOfServicePage", () => {
  beforeEach(() => {
    render(<TermsOfServicePage />);
  });

  it("should render the page title", () => {
    expect(screen.getByText("Terms of Service")).toBeInTheDocument();
  });

  it("should render the last updated date", () => {
    expect(screen.getByText(/Last updated: June 2026/)).toBeInTheDocument();
  });

  it("should render all 11 sections", () => {
    expect(screen.getByText("1. Acceptance of Terms")).toBeInTheDocument();
    expect(screen.getByText("2. Eligibility")).toBeInTheDocument();
    expect(screen.getByText("3. Account Responsibilities")).toBeInTheDocument();
    expect(screen.getByText("4. Acceptable Use")).toBeInTheDocument();
    expect(screen.getByText("5. Civic Data & AI Analysis")).toBeInTheDocument();
    expect(screen.getByText("6. Public Commitments")).toBeInTheDocument();
    expect(screen.getByText("7. Intellectual Property")).toBeInTheDocument();
    expect(screen.getByText("8. Limitation of Liability")).toBeInTheDocument();
    expect(screen.getByText("9. Termination")).toBeInTheDocument();
    expect(screen.getByText("10. Governing Law")).toBeInTheDocument();
    expect(screen.getByText("11. Contact Information")).toBeInTheDocument();
  });

  it("should link to /our-commitments from section 6", () => {
    const commitmentsLink = screen.getByRole("link", {
      name: "/our-commitments",
    });
    expect(commitmentsLink).toHaveAttribute("href", "/our-commitments");
  });

  it("should include links to Privacy Policy", () => {
    const privacyLinks = screen.getAllByRole("link", {
      name: "Privacy Policy",
    });
    expect(privacyLinks.length).toBeGreaterThanOrEqual(1);
    privacyLinks.forEach((link) => {
      expect(link).toHaveAttribute("href", "/privacy");
    });
  });

  it("should include a link to Transparency page", () => {
    const transparencyLink = screen.getByRole("link", {
      name: "Transparency",
    });
    expect(transparencyLink).toHaveAttribute("href", "/transparency");
  });

  it("should include a link to privacy settings", () => {
    const settingsLink = screen.getByRole("link", {
      name: "privacy settings",
    });
    expect(settingsLink).toHaveAttribute("href", "/settings/privacy");
  });

  it("should include contact email", () => {
    // Section 6 (Public Commitments) AND Section 11 (Contact) both link
    // legal@opuspopuli.org. Assert at least one exists and that every
    // legal-email link routes correctly.
    const emailLinks = screen.getAllByRole("link", {
      name: "legal@opuspopuli.org",
    });
    expect(emailLinks.length).toBeGreaterThanOrEqual(1);
    emailLinks.forEach((link) =>
      expect(link).toHaveAttribute("href", "mailto:legal@opuspopuli.org"),
    );
  });

  it("should render header and footer", () => {
    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    expect(screen.getByTestId("mock-footer")).toBeInTheDocument();
  });

  it("should mention minimum age requirement", () => {
    expect(screen.getByText(/at least 13 years of age/)).toBeInTheDocument();
  });

  it("should mention open-source", () => {
    expect(screen.getByText(/open-source project/)).toBeInTheDocument();
  });

  it("should mention California governing law", () => {
    expect(screen.getByText(/State of California/)).toBeInTheDocument();
  });
});
