import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DocumentFrameOverlay } from "@/components/camera/DocumentFrameOverlay";
import { getExclusionBand } from "@/lib/vision/exclusion-band";
import type { Quad } from "@/lib/vision/perspective";

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
    const whiteBars = container.querySelectorAll(".bg-paper.rounded-full");
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
  /**
   * The excluded band (#1075). This overlay is the only place a person can see,
   * before pressing the shutter, that the signature rows fall outside what gets
   * uploaded — so the assertion that matters is not that a rectangle renders,
   * but that it renders where `getExclusionBand` says the crop falls, and that
   * it stays inside something the person can see.
   */
  describe("excluded band", () => {
    const CONTAINER = { width: 390, height: 750 };
    const frame = { frameWidth: 1000, frameHeight: 2000 };
    const page: Quad = [
      { x: 100, y: 200 },
      { x: 900, y: 200 },
      { x: 900, y: 1800 },
      { x: 100, y: 1800 },
    ];

    /**
     * Layout is inert in jsdom, so the overlay measures 0x0 and draws no band.
     * Stubbing the size is what lets these tests exercise the real geometry
     * rather than pass vacuously against an element that never appears.
     */
    beforeEach(() => {
      jest
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(CONTAINER.width);
      jest
        .spyOn(HTMLElement.prototype, "clientHeight", "get")
        .mockReturnValue(CONTAINER.height);
    });

    afterEach(() => jest.restoreAllMocks());

    function band(container: HTMLElement) {
      return container.querySelector<HTMLElement>(
        '[data-testid="exclusion-band"]',
      );
    }

    function expected(quad: Quad | null) {
      return getExclusionBand({
        ...frame,
        quad,
        containerWidth: CONTAINER.width,
        containerHeight: CONTAINER.height,
        padding: 32,
        aspectRatio: 8.5 / 11,
      })!;
    }

    it("is placed where the crop boundary falls", () => {
      const { container } = render(
        <DocumentFrameOverlay {...frame} quad={page} />,
      );

      const el = band(container)!;
      const want = expected(page);
      expect(el.style.top).toBe(`${want.top}px`);
      expect(el.style.height).toBe(`${want.height}px`);
    });

    /**
     * The band describes a region of the SHEET. Running to the screen edges
     * read as "the camera is blocked down here" and covered UI that has
     * nothing to do with the crop.
     */
    it("stays inside the detected page", () => {
      const { container } = render(
        <DocumentFrameOverlay {...frame} quad={page} />,
      );

      const el = band(container)!;
      const want = expected(page);
      expect(parseFloat(el.style.left)).toBeGreaterThan(0);
      expect(want.left + want.width).toBeLessThan(CONTAINER.width);
      expect(want.top + want.height).toBeLessThan(CONTAINER.height);
    });

    /**
     * No detected page is when the band matters most — that is exactly when a
     * signature block is most likely drifting through the shot. It falls back
     * to the guide box, which is still bounded, not the whole screen.
     */
    it("falls back to the guide box when no page is detected", () => {
      const { container } = render(
        <DocumentFrameOverlay {...frame} quad={null} />,
      );

      const want = expected(null);
      expect(band(container)).toBeInTheDocument();
      expect(want.top + want.height).toBeLessThan(CONTAINER.height);
    });

    it("excludes more when no page is detected", () => {
      expect(expected(null).top).toBeLessThan(expected(page).top);
    });

    it("renders the privacy notice the caller supplied", () => {
      render(
        <DocumentFrameOverlay
          {...frame}
          quad={page}
          excludedNotice="This area is not captured to protect the privacy of signers"
        />,
      );

      expect(
        screen.getByText(
          "This area is not captured to protect the privacy of signers",
        ),
      ).toBeInTheDocument();
    });

    /**
     * A square viewBox cannot reproduce object-cover of a non-square camera
     * frame, which threw the page outline well off the real edges.
     */
    it("draws the page outline in frame coordinates", () => {
      const { container } = render(
        <DocumentFrameOverlay {...frame} quad={page} />,
      );

      const outline = container.querySelector("polygon")?.closest("svg");
      expect(outline?.getAttribute("viewBox")).toBe("0 0 1000 2000");
    });

    /** Before the camera reports a frame size there is no boundary to draw. */
    it("draws nothing without frame dimensions", () => {
      const { container } = render(<DocumentFrameOverlay />);

      expect(band(container)).not.toBeInTheDocument();
    });
  });
});
