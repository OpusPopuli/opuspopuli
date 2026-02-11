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

  it("should apply animate-spin class", () => {
    const { container } = render(<LoadingSpinner />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("animate-spin");
  });

  describe("sizes", () => {
    it("should default to small size", () => {
      const { container } = render(<LoadingSpinner />);

      const svg = container.querySelector("svg");
      expect(svg).toHaveClass("h-4", "w-4");
    });

    it("should render medium size", () => {
      const { container } = render(<LoadingSpinner size="md" />);

      const svg = container.querySelector("svg");
      expect(svg).toHaveClass("h-6", "w-6");
    });

    it("should render large size", () => {
      const { container } = render(<LoadingSpinner size="lg" />);

      const svg = container.querySelector("svg");
      expect(svg).toHaveClass("h-10", "w-10");
    });
  });

  it("should apply custom className", () => {
    const { container } = render(<LoadingSpinner className="text-blue-500" />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("text-blue-500");
  });
});
