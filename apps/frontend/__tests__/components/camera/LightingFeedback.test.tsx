import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LightingFeedback } from "@/components/camera/LightingFeedback";

describe("LightingFeedback", () => {
  it("should display dark lighting message", () => {
    render(<LightingFeedback level="dark" />);

    expect(screen.getByText("Move to a brighter area")).toBeInTheDocument();
  });

  it("should display good lighting message", () => {
    render(<LightingFeedback level="good" />);

    expect(screen.getByText("Good lighting")).toBeInTheDocument();
  });

  it("should display bright lighting message", () => {
    render(<LightingFeedback level="bright" />);

    expect(screen.getByText(/Too bright/)).toBeInTheDocument();
  });

  it("should apply green background for good lighting", () => {
    const { container } = render(<LightingFeedback level="good" />);

    const badge = container.querySelector(".bg-green-600");
    expect(badge).toBeInTheDocument();
  });

  it("should apply yellow background for dark lighting", () => {
    const { container } = render(<LightingFeedback level="dark" />);

    const badge = container.querySelector(".bg-yellow-600");
    expect(badge).toBeInTheDocument();
  });

  it("should apply orange background for bright lighting", () => {
    const { container } = render(<LightingFeedback level="bright" />);

    const badge = container.querySelector(".bg-orange-600");
    expect(badge).toBeInTheDocument();
  });

  it("should render an icon for each state", () => {
    const { container } = render(<LightingFeedback level="good" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
