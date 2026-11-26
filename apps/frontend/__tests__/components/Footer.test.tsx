import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { Footer } from "@/components/Footer";
import i18n from "@/lib/i18n";

describe("Footer", () => {
  beforeEach(() => {
    render(<Footer />);
  });

  it("should render copyright text", () => {
    const year = new Date().getFullYear();
    expect(
      screen.getByText(new RegExp(`${year} Opus Populi`)),
    ).toBeInTheDocument();
  });

  it("should render Privacy Policy link", () => {
    const link = screen.getByRole("link", { name: "Privacy Policy" });
    expect(link).toHaveAttribute("href", "/privacy");
  });

  it("should render Terms of Service link", () => {
    const link = screen.getByRole("link", { name: "Terms of Service" });
    expect(link).toHaveAttribute("href", "/terms");
  });

  it("should render Transparency link", () => {
    const link = screen.getByRole("link", { name: "Transparency" });
    expect(link).toHaveAttribute("href", "/transparency");
  });

  it("renders the illustrative-purpose / not-an-allegation notice (#962)", () => {
    expect(screen.getByText(/illustrative purposes/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not\s+an allegation of wrongdoing/i),
    ).toBeInTheDocument();
  });
});

describe("Footer in Spanish (#962)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("carries the illustrative-purpose notice and its links in Spanish", async () => {
    await i18n.changeLanguage("es");
    render(<Footer />);
    expect(
      screen.getByText(
        /herramienta de educación cívica con fines ilustrativos/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no constituyen una acusación de conducta indebida/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Política de Privacidad" }),
    ).toHaveAttribute("href", "/privacy");
  });
});
