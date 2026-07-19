import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LoadingSpinner } from "@/components/LoadingSpinner";

describe("LoadingSpinner", () => {
  it("should render an SVG element", () => {
    const { container } = render(<LoadingSpinner />);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should be hidden from screen readers", () => {
    const { container } = render(<LoadingSpinner />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("should apply the loading-state animation class (pinwheel)", () => {
    const { container } = render(<LoadingSpinner />);

    // The spinner is now the sunflower mark; `.s-loading` drives the pinwheel
    // animation in globals.css.
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("s-loading");
  });

  describe("sizes", () => {
    it("should default to small size", () => {
      const { container } = render(<LoadingSpinner />);

      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("width", "24");
      expect(svg).toHaveAttribute("height", "24");
    });

    it("should render medium size", () => {
      const { container } = render(<LoadingSpinner size="md" />);

      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("width", "40");
      expect(svg).toHaveAttribute("height", "40");
    });

    it("should render large size", () => {
      const { container } = render(<LoadingSpinner size="lg" />);

      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("width", "64");
      expect(svg).toHaveAttribute("height", "64");
    });
  });

  it("should apply custom className", () => {
    const { container } = render(<LoadingSpinner className="text-blue-500" />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("text-blue-500");
  });
});
