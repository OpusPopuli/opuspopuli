import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DocumentFrameOverlay } from "@/components/camera/DocumentFrameOverlay";

describe("DocumentFrameOverlay", () => {
  it("should render the overlay container", () => {
    const { container } = render(<DocumentFrameOverlay />);

    const overlay = container.firstChild as HTMLElement;
    expect(overlay).toHaveClass("absolute", "inset-0", "pointer-events-none");
  });

  it("should be hidden from screen readers", () => {
    const { container } = render(<DocumentFrameOverlay />);

    const overlay = container.firstChild as HTMLElement;
    expect(overlay).toHaveAttribute("aria-hidden", "true");
  });

  it("should render guide text", () => {
    render(<DocumentFrameOverlay />);

    expect(
      screen.getByText("Align petition within the frame"),
    ).toBeInTheDocument();
  });

  it("should render SVG mask for dark overlay", () => {
    const { container } = render(<DocumentFrameOverlay />);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should render four corner brackets", () => {
    const { container } = render(<DocumentFrameOverlay />);

    // Each corner has 2 divs (horizontal + vertical bar), so 8 white bars total
    const whiteBars = container.querySelectorAll(".bg-white.rounded-full");
    expect(whiteBars.length).toBe(8);
  });

  it("should apply pulse animation when animated is true", () => {
    const { container } = render(<DocumentFrameOverlay animated={true} />);

    const animatedElements = container.querySelectorAll(".animate-pulse");
    expect(animatedElements.length).toBe(4);
  });

  it("should not apply pulse animation when animated is false", () => {
    const { container } = render(<DocumentFrameOverlay animated={false} />);

    const animatedElements = container.querySelectorAll(".animate-pulse");
    expect(animatedElements.length).toBe(0);
  });
});
