import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BriefingSection } from "@/components/briefing/BriefingSection";

describe("BriefingSection", () => {
  it("renders the title + subtitle + children", () => {
    render(
      <BriefingSection
        slug="bills"
        title="Bills moving this week"
        subtitle="Ranked by relevance to your life."
        seeAllHref="/region/bills"
      >
        <p>body content</p>
      </BriefingSection>,
    );
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /bills moving this week/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ranked by relevance/i)).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
  });

  it("renders the See all link pointing at the supplied href", () => {
    render(
      <BriefingSection slug="bills" title="Bills" seeAllHref="/region/bills">
        <p>body</p>
      </BriefingSection>,
    );
    const link = screen.getByRole("link", { name: /see all/i });
    expect(link).toHaveAttribute("href", "/region/bills");
  });

  it("exposes a data-section attribute matching the slug for e2e selectors", () => {
    const { container } = render(
      <BriefingSection
        slug="reps"
        title="Reps"
        seeAllHref="/region/representatives"
      >
        <p>body</p>
      </BriefingSection>,
    );
    expect(
      container.querySelector('[data-section="reps"]'),
    ).toBeInTheDocument();
  });

  it("renders an optional icon when provided", () => {
    render(
      <BriefingSection
        slug="bills"
        title="Bills"
        seeAllHref="/region/bills"
        icon={<svg data-testid="bills-icon" />}
      >
        <p>body</p>
      </BriefingSection>,
    );
    expect(screen.getByTestId("bills-icon")).toBeInTheDocument();
  });
});
