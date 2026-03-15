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
    expect(screen.getByText(/Last updated: March 2026/)).toBeInTheDocument();
  });

  it("should render all 10 sections", () => {
    expect(screen.getByText("1. Acceptance of Terms")).toBeInTheDocument();
    expect(screen.getByText("2. Eligibility")).toBeInTheDocument();
    expect(screen.getByText("3. Account Responsibilities")).toBeInTheDocument();
    expect(screen.getByText("4. Acceptable Use")).toBeInTheDocument();
    expect(screen.getByText("5. Civic Data & AI Analysis")).toBeInTheDocument();
    expect(screen.getByText("6. Intellectual Property")).toBeInTheDocument();
    expect(screen.getByText("7. Limitation of Liability")).toBeInTheDocument();
    expect(screen.getByText("8. Termination")).toBeInTheDocument();
    expect(screen.getByText("9. Governing Law")).toBeInTheDocument();
    expect(screen.getByText("10. Contact Information")).toBeInTheDocument();
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
    const emailLink = screen.getByRole("link", {
      name: "legal@opuspopuli.org",
    });
    expect(emailLink).toHaveAttribute("href", "mailto:legal@opuspopuli.org");
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
