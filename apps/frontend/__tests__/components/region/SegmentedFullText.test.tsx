import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedFullText } from "@/components/region/SegmentedFullText";

// Regression guard for the Cloudflare Worker CPU limit: a proposition's full
// text can be 100KB+ (an un-analyzed ballot initiative is one section spanning
// all of it). Auto-opening that on the server render overran the Worker CPU
// budget and 500'd /region/propositions/[id]. Large text must start collapsed.
const BODY_MARKER = "ZZBODYMARKERZZ";

describe("SegmentedFullText — SSR CPU safety", () => {
  it("starts a large single full-text section collapsed (body not rendered)", () => {
    // > 40KB budget → must be collapsed on first render.
    const fullText = `${BODY_MARKER} ${"x".repeat(45_000)}`;

    render(<SegmentedFullText fullText={fullText} sections={[]} claims={[]} />);

    // Heading + toggle are present, but the heavy body text is not.
    expect(screen.getByText("Show")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(BODY_MARKER);
  });

  it("still lets the reader open the large section on the client", async () => {
    const user = userEvent.setup();
    const fullText = `${BODY_MARKER} ${"x".repeat(45_000)}`;

    render(<SegmentedFullText fullText={fullText} sections={[]} claims={[]} />);

    await user.click(screen.getByText("Show"));

    expect(document.body.textContent).toContain(BODY_MARKER);
  });

  it("keeps a small full-text section open by default", () => {
    const fullText = `${BODY_MARKER} short body`;

    render(<SegmentedFullText fullText={fullText} sections={[]} claims={[]} />);

    expect(document.body.textContent).toContain(BODY_MARKER);
  });
});
