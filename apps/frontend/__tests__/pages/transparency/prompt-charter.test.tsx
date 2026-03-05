import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

import PromptCharterPage from "@/app/transparency/prompt-charter/page";

describe("PromptCharterPage", () => {
  beforeEach(() => {
    render(<PromptCharterPage />);
  });

  it("should render the page title", () => {
    expect(screen.getByText("Prompt Service Charter")).toBeInTheDocument();
  });

  it("should render the last updated date", () => {
    expect(screen.getByText(/Last updated: March 2026/)).toBeInTheDocument();
  });

  it("should render all 5 sections", () => {
    expect(screen.getByText("1. What Prompts Do")).toBeInTheDocument();
    expect(screen.getByText("2. Design Principles")).toBeInTheDocument();
    expect(screen.getByText("3. How Prompts Are Managed")).toBeInTheDocument();
    expect(
      screen.getByText("4. Verification and Auditability"),
    ).toBeInTheDocument();
    expect(screen.getByText("5. What We Do Not Disclose")).toBeInTheDocument();
  });

  it("should render all 4 design principles", () => {
    expect(screen.getByText("Neutrality")).toBeInTheDocument();
    expect(screen.getByText("Completeness")).toBeInTheDocument();
    expect(screen.getByText("Source Attribution")).toBeInTheDocument();
    expect(screen.getByText("Transparency")).toBeInTheDocument();
  });

  it("should link to AI System Card", () => {
    const links = screen.getAllByRole("link", { name: /System Card/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", "/transparency/system-card");
  });

  it("should link to AI Commitments", () => {
    const links = screen.getAllByRole("link", { name: /AI Commitments/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", "/transparency/ai-commitments");
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
