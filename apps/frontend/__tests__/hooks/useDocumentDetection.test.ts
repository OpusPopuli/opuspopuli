import { classifyReadiness } from "@/lib/hooks/useDocumentDetection";

describe("classifyReadiness", () => {
  const MIN_COVERAGE = 0.4;
  const MIN_SHARP = 40;

  it("says searching when no document is found", () => {
    expect(
      classifyReadiness(
        { coverage: 0, sharpness: 100, hasQuad: false },
        MIN_COVERAGE,
        MIN_SHARP,
      ),
    ).toEqual({ ready: false, hint: "searching" });
  });

  it("says move_closer when the document is too small", () => {
    expect(
      classifyReadiness(
        { coverage: 0.2, sharpness: 100, hasQuad: true },
        MIN_COVERAGE,
        MIN_SHARP,
      ),
    ).toEqual({ ready: false, hint: "move_closer" });
  });

  it("says hold_steady when framed but blurry", () => {
    expect(
      classifyReadiness(
        { coverage: 0.6, sharpness: 10, hasQuad: true },
        MIN_COVERAGE,
        MIN_SHARP,
      ),
    ).toEqual({ ready: false, hint: "hold_steady" });
  });

  it("is ready when framed and sharp", () => {
    expect(
      classifyReadiness(
        { coverage: 0.6, sharpness: 120, hasQuad: true },
        MIN_COVERAGE,
        MIN_SHARP,
      ),
    ).toEqual({ ready: true, hint: "ready" });
  });

  it("prioritises the first thing to fix (coverage before sharpness)", () => {
    // Too small AND blurry -> tell them to move closer first.
    expect(
      classifyReadiness(
        { coverage: 0.1, sharpness: 5, hasQuad: true },
        MIN_COVERAGE,
        MIN_SHARP,
      ).hint,
    ).toBe("move_closer");
  });
});
