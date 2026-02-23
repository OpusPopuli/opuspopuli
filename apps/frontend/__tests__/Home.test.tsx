import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock the Header component since it requires AuthProvider
jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

import Home from "../app/page";

describe("Home Page", () => {
  beforeEach(() => {
    render(<Home />);
  });

  describe("Layout", () => {
    it("should render the footer", () => {
      expect(screen.getByTestId("mock-footer")).toBeInTheDocument();
    });
  });

  describe("Header section", () => {
    it("should display Opus Populi title", () => {
      const title = screen.getByText(/Opus Populi/i);
      expect(title).toBeInTheDocument();
    });

    it("should display subtitle", () => {
      const subtitle = screen.getByText(
        /Quick start platform for building AI-powered applications/i,
      );
      expect(subtitle).toBeInTheDocument();
    });
  });

  describe("Feature cards", () => {
    it("should have RAG Demo link", () => {
      const ragDemoLink = screen.getByRole("link", { name: /RAG Demo/i });
      expect(ragDemoLink).toBeInTheDocument();
      expect(ragDemoLink).toHaveAttribute("href", "/rag-demo");
    });

    it("should display RAG Demo description", () => {
      const description = screen.getByText(
        /Upload documents, index them into the vector database/i,
      );
      expect(description).toBeInTheDocument();
    });

    it("should display More Features section", () => {
      const moreFeatures = screen.getByText(/More Features/i);
      expect(moreFeatures).toBeInTheDocument();
    });

    it("should display coming soon message", () => {
      const comingSoon = screen.getByText(
        /Additional features and demos coming soon/i,
      );
      expect(comingSoon).toBeInTheDocument();
    });
  });

  describe("Platform Features section", () => {
    it("should display Platform Features heading", () => {
      const heading = screen.getByText(/Platform Features/i);
      expect(heading).toBeInTheDocument();
    });

    it("should display GraphQL API badge", () => {
      const badge = screen.getByText(/GraphQL API/i);
      expect(badge).toBeInTheDocument();
    });

    it("should display Vector Database badge", () => {
      const badges = screen.getAllByText(/Vector Database/i);
      // One in RAG Demo description, one in Platform Features
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it("should display LLM Integration badge", () => {
      const badge = screen.getByText(/LLM Integration/i);
      expect(badge).toBeInTheDocument();
    });

    it("should display Document Processing badge", () => {
      const badge = screen.getByText(/Document Processing/i);
      expect(badge).toBeInTheDocument();
    });

    it("should display User Authentication badge", () => {
      const badge = screen.getByText(/User Authentication/i);
      expect(badge).toBeInTheDocument();
    });
  });
});
