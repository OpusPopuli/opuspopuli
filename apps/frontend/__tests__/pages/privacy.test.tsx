import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock the Header and Footer components
jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

import PrivacyPolicyPage from "@/app/privacy/page";

describe("PrivacyPolicyPage", () => {
  beforeEach(() => {
    render(<PrivacyPolicyPage />);
  });

  it("should render the page title", () => {
    expect(screen.getByText("Privacy Policy")).toBeInTheDocument();
  });

  it("should render the last updated date", () => {
    expect(screen.getByText(/Last updated: November 2026/)).toBeInTheDocument();
  });

  it("should render all 9 sections", () => {
    expect(screen.getByText("1. Information We Collect")).toBeInTheDocument();
    expect(
      screen.getByText("2. How We Use Your Information"),
    ).toBeInTheDocument();
    expect(screen.getByText("3. Data Retention")).toBeInTheDocument();
    expect(screen.getByText("4. Your Rights")).toBeInTheDocument();
    expect(screen.getByText("5. Security Measures")).toBeInTheDocument();
    expect(screen.getByText("6. Third-Party Services")).toBeInTheDocument();
    expect(screen.getByText("7. Children's Privacy")).toBeInTheDocument();
    expect(screen.getByText("8. Changes to This Policy")).toBeInTheDocument();
    expect(screen.getByText("9. Contact Information")).toBeInTheDocument();
  });

  it("should include a link to data export settings", () => {
    const exportLink = screen.getByRole("link", { name: "data export" });
    expect(exportLink).toHaveAttribute("href", "/settings/privacy");
  });

  it("should include a link to privacy settings", () => {
    const settingsLink = screen.getByRole("link", {
      name: "privacy settings",
    });
    expect(settingsLink).toHaveAttribute("href", "/settings/privacy");
  });

  it("should include contact email", () => {
    const emailLink = screen.getByRole("link", {
      name: "privacy@opuspopuli.org",
    });
    expect(emailLink).toHaveAttribute("href", "mailto:privacy@opuspopuli.org");
  });

  it("should state data is not sold", () => {
    expect(
      screen.getByText("We do not sell your personal data to third parties."),
    ).toBeInTheDocument();
  });

  it("should render header and footer", () => {
    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    expect(screen.getByTestId("mock-footer")).toBeInTheDocument();
  });

  describe("reading without an account (#1456)", () => {
    it("gives notice at collection for the location lookup", () => {
      const section = document.getElementById("without-an-account");
      expect(section).not.toBeNull();
      expect(
        within(section!).getByRole("heading", {
          name: "Reading without an account",
        }),
      ).toBeInTheDocument();
      // Purpose, the third party an address goes to, what's kept, and
      // what stays on the device: the four things a notice must say.
      const text = section!.textContent ?? "";
      expect(text).toMatch(/to find the districts that contain it/);
      expect(text).toMatch(/Census Bureau/);
      expect(text).toMatch(/What we keep:\s*nothing/);
      expect(text).toMatch(/only the list of\s+your districts/);
    });

    it("names the Census geocoder among third-party services", () => {
      expect(
        screen.getByText(/U\.S\. Census Bureau Geocoder:/, {
          selector: "strong",
        }),
      ).toBeInTheDocument();
    });
  });
});
