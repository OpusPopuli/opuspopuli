import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

import SystemCardPage from "@/app/transparency/system-card/page";

describe("SystemCardPage", () => {
  beforeEach(() => {
    render(<SystemCardPage />);
  });

  it("should render the page title", () => {
    expect(screen.getByText("AI System Card")).toBeInTheDocument();
  });

  it("should render the last updated date", () => {
    expect(screen.getByText(/Last updated: March 2026/)).toBeInTheDocument();
  });

  it("should render all 8 sections", () => {
    expect(screen.getByText("1. What the AI Does")).toBeInTheDocument();
    expect(screen.getByText("2. Data Processed")).toBeInTheDocument();
    expect(screen.getByText("3. Training Data and Models")).toBeInTheDocument();
    expect(screen.getByText("4. Prompt Architecture")).toBeInTheDocument();
    expect(screen.getByText("5. Known Limitations")).toBeInTheDocument();
    expect(screen.getByText("6. Failure Modes")).toBeInTheDocument();
    expect(screen.getByText("7. Abuse Reporting")).toBeInTheDocument();
    expect(screen.getByText("8. Changelog")).toBeInTheDocument();
  });

  it("should link to AI Commitments", () => {
    const links = screen.getAllByRole("link", { name: /AI Commitments/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", "/transparency/ai-commitments");
  });

  it("should link to Prompt Service Charter", () => {
    const links = screen.getAllByRole("link", {
      name: /Prompt Service Charter/,
    });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", "/transparency/prompt-charter");
  });

  it("should include abuse reporting contact email", () => {
    const emailLink = screen.getByRole("link", {
      name: "transparency@opuspopuli.org",
    });
    expect(emailLink).toHaveAttribute(
      "href",
      "mailto:transparency@opuspopuli.org",
    );
  });

  it("should render the changelog table", () => {
    expect(screen.getByText("v1.0")).toBeInTheDocument();
    expect(
      screen.getByText("Initial system card publication."),
    ).toBeInTheDocument();
  });

  it("should link back to transparency index", () => {
    const link = screen.getByRole("link", {
      name: /Back to Transparency/,
    });
    expect(link).toHaveAttribute("href", "/transparency");
  });

  it("should render header and footer", () => {
    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    expect(screen.getByTestId("mock-footer")).toBeInTheDocument();
  });
});
