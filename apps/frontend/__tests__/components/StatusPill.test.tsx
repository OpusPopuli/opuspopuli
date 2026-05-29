import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StatusPill, type StatusPillTone } from "@/components/StatusPill";

describe("StatusPill", () => {
  it("renders the child label", () => {
    render(<StatusPill tone="sage-filled">Primary</StatusPill>);
    expect(screen.getByText("Primary")).toBeInTheDocument();
  });

  // Lock the tone→class mapping. A future rename of a sage token or a
  // careless edit to TONE_CLASSES would change these assertions; that's
  // the regression we want to catch. We assert positively on the
  // expected tokens and on the shared chrome (padding, radius, text
  // size) so a structural rewrite doesn't slip past either.
  describe.each<{ tone: StatusPillTone; expectedClasses: string[] }>([
    {
      tone: "sage-filled",
      expectedClasses: [
        "bg-sage-light/20",
        "text-sage-darker",
        "dark:bg-sage-dark/20",
        "dark:text-sage-light",
      ],
    },
    {
      tone: "sage-outline",
      expectedClasses: [
        "border",
        "border-sage-dark",
        "text-sage-dark",
        "dark:border-sage-light",
        "dark:text-sage-light",
      ],
    },
    {
      tone: "warning",
      expectedClasses: [
        "bg-yellow-100",
        "text-yellow-700",
        "dark:bg-yellow-900/30",
        "dark:text-yellow-200",
      ],
    },
    {
      tone: "danger",
      expectedClasses: [
        "bg-red-100",
        "text-red-700",
        "dark:bg-red-900/30",
        "dark:text-red-200",
      ],
    },
    {
      tone: "neutral",
      expectedClasses: [
        "bg-gray-100",
        "text-gray-700",
        "dark:bg-gray-700",
        "dark:text-gray-200",
      ],
    },
  ])("tone=$tone", ({ tone, expectedClasses }) => {
    it("applies the expected token classes", () => {
      render(<StatusPill tone={tone}>label</StatusPill>);
      const pill = screen.getByText("label");
      expectedClasses.forEach((cls) => {
        expect(pill).toHaveClass(cls);
      });
    });

    it("applies the shared chrome (padding, radius, text size)", () => {
      render(<StatusPill tone={tone}>label</StatusPill>);
      const pill = screen.getByText("label");
      expect(pill).toHaveClass(
        "px-2",
        "py-0.5",
        "text-xs",
        "font-medium",
        "rounded",
      );
    });
  });
});
