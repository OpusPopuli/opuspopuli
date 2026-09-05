import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock the Header component since it requires AuthProvider
jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

jest.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer">Mock Footer</footer>,
}));

// Needs Apollo, auth and i18n contexts, and owns the MapLibre dynamic import.
// Its behaviour is covered by the CountyHero/CountyMap/CountyRail specs; here
// we only care that the page composes the two halves of the argument.
jest.mock("@/components/landing/CountyHero", () => ({
  CountyHero: () => <section data-testid="mock-county-hero">Mock hero</section>,
}));

jest.mock("@/components/landing/CountyArgument", () => ({
  CountyArgument: () => (
    <section data-testid="mock-county-argument">Mock argument</section>
  ),
}));

import Home from "../app/page";

describe("Home Page", () => {
  beforeEach(() => {
    render(<Home />);
  });

  it("renders the header", () => {
    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
  });

  it("renders the footer", () => {
    expect(screen.getByTestId("mock-footer")).toBeInTheDocument();
  });

  it("leads with the county hero", () => {
    expect(screen.getByTestId("mock-county-hero")).toBeInTheDocument();
  });

  it("renders the argument below the hero", () => {
    expect(screen.getByTestId("mock-county-argument")).toBeInTheDocument();
  });

  // The hero has to come first: the page's claim is the county figure, and the
  // sections underneath only make sense once the reader has seen one.
  it("orders the hero before the argument", () => {
    const hero = screen.getByTestId("mock-county-hero");
    const argument = screen.getByTestId("mock-county-argument");
    expect(hero.compareDocumentPosition(argument)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
