import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

import AICommitmentsPage from "@/app/transparency/ai-commitments/page";

describe("AICommitmentsPage", () => {
  beforeEach(() => {
    render(<AICommitmentsPage />);
  });

  it("should render the page title", () => {
    expect(screen.getByText("AI Commitments")).toBeInTheDocument();
  });

  it("should render the intro text", () => {
    expect(screen.getByText(/binding commitments/)).toBeInTheDocument();
  });

  it("should render all 6 commitment headings", () => {
    expect(
      screen.getByText("Never Make Voting Recommendations"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Never Suppress or Promote Political Positions"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Never Store Prompt Templates in Client Code"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Never Train on User Documents"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Never Share Data Between Federated Nodes Without Consent",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Never Sell or Monetize User Data"),
    ).toBeInTheDocument();
  });

  it("should render Technical Control for each commitment", () => {
    const controls = screen.getAllByText("Technical Control:");
    expect(controls).toHaveLength(6);
  });

  it("should render How to Verify for each commitment", () => {
    const verifications = screen.getAllByText("How to Verify:");
    expect(verifications).toHaveLength(6);
  });

  it("should link to AI System Overview", () => {
    const link = screen.getByRole("link", { name: /AI System Overview/ });
    expect(link).toHaveAttribute("href", "/transparency/system-card");
  });

  it("should link to Prompt Service Charter", () => {
    const link = screen.getByRole("link", {
      name: /Prompt Service Charter/,
    });
    expect(link).toHaveAttribute("href", "/transparency/prompt-charter");
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
