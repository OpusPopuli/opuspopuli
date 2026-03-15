import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock the Header component since it requires AuthProvider
jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

jest.mock("@/components/landing/LandingCTA", () => ({
  LandingCTA: () => <div data-testid="mock-landing-cta">Mock CTA</div>,
}));

import Home from "../app/page";

describe("Home Page", () => {
  beforeEach(() => {
    render(<Home />);
  });

  describe("Layout", () => {
    it("should render the header", () => {
      expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    });

    it("should render the footer", () => {
      expect(screen.getByTestId("mock-footer")).toBeInTheDocument();
    });

    it("should render the CTA", () => {
      expect(screen.getByTestId("mock-landing-cta")).toBeInTheDocument();
    });
  });

  describe("Hero section", () => {
    it("should display civic engagement headline", () => {
      expect(screen.getByText(/Know your ballot/i)).toBeInTheDocument();
      expect(screen.getByText(/Hold power accountable/i)).toBeInTheDocument();
    });

    it("should display subtitle", () => {
      expect(
        screen.getByText(/Transparent access to propositions/i),
      ).toBeInTheDocument();
    });
  });

  describe("Feature cards", () => {
    it("should display Ballot & Propositions card", () => {
      expect(screen.getByText("Ballot & Propositions")).toBeInTheDocument();
    });

    it("should display Petition Scanner card", () => {
      expect(screen.getByText("Petition Scanner")).toBeInTheDocument();
    });

    it("should display Representatives & Meetings card", () => {
      expect(
        screen.getByText("Representatives & Meetings"),
      ).toBeInTheDocument();
    });

    it("should display Campaign Finance card", () => {
      expect(screen.getByText("Campaign Finance")).toBeInTheDocument();
    });
  });

  describe("Trust signals section", () => {
    it("should display trust section heading", () => {
      expect(
        screen.getByText(/Built on trust and transparency/i),
      ).toBeInTheDocument();
    });

    it("should display AI Transparency", () => {
      expect(screen.getByText("AI Transparency")).toBeInTheDocument();
    });

    it("should display Privacy First", () => {
      expect(screen.getByText("Privacy First")).toBeInTheDocument();
    });

    it("should display Open Source", () => {
      expect(screen.getByText("Open Source")).toBeInTheDocument();
    });
  });
});
