import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { Footer } from "@/components/Footer";

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
});
