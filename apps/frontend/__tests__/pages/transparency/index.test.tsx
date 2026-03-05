import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

import TransparencyPage from "@/app/transparency/page";

describe("TransparencyPage", () => {
  beforeEach(() => {
    render(<TransparencyPage />);
  });

  it("should render the page title", () => {
    expect(screen.getByText("Transparency")).toBeInTheDocument();
  });

  it("should render intro text", () => {
    expect(
      screen.getByText(/committed to AI transparency/),
    ).toBeInTheDocument();
  });

  it("should render AI System Card link", () => {
    const link = screen.getByRole("link", { name: /AI System Card/ });
    expect(link).toHaveAttribute("href", "/transparency/system-card");
  });

  it("should render AI Commitments link", () => {
    const link = screen.getByRole("link", { name: /AI Commitments/ });
    expect(link).toHaveAttribute("href", "/transparency/ai-commitments");
  });

  it("should render Prompt Service Charter link", () => {
    const link = screen.getByRole("link", {
      name: /Prompt Service Charter/,
    });
    expect(link).toHaveAttribute("href", "/transparency/prompt-charter");
  });

  it("should render all three card descriptions", () => {
    expect(
      screen.getByText(/How our AI works, what data it processes/),
    ).toBeInTheDocument();
    expect(screen.getByText(/What this AI will never do/)).toBeInTheDocument();
    expect(
      screen.getByText(/How our prompts are designed, managed/),
    ).toBeInTheDocument();
  });

  it("should render header and footer", () => {
    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    expect(screen.getByTestId("mock-footer")).toBeInTheDocument();
  });
});
