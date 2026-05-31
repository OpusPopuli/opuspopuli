import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { BriefingSection } from "@/components/briefing/BriefingSection";

beforeEach(() => {
  // Each test starts with a clean slate — collapse state is keyed on
  // section slug and we don't want one test's toggle to leak into the
  // next test's "should default to expanded" assertion.
  window.localStorage.clear();
});

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

  describe("collapsibility (S0 / #771)", () => {
    it("defaults to expanded so children are visible on first paint", () => {
      render(
        <BriefingSection slug="bills" title="Bills" seeAllHref="/region/bills">
          <p>body content</p>
        </BriefingSection>,
      );
      expect(
        screen.getByRole("button", { name: /collapse bills section/i }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("body content")).toBeVisible();
    });

    it("collapses on click and persists the choice to localStorage", async () => {
      const user = userEvent.setup();
      render(
        <BriefingSection slug="bills" title="Bills" seeAllHref="/region/bills">
          <p>body content</p>
        </BriefingSection>,
      );

      await user.click(
        screen.getByRole("button", { name: /collapse bills section/i }),
      );

      // After collapse: button reports false, content is hidden, storage
      // remembers the choice for next mount.
      const toggle = screen.getByRole("button", {
        name: /expand bills section/i,
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("body content")).not.toBeVisible();
      expect(
        window.localStorage.getItem("briefing:section:bills:expanded"),
      ).toBe("false");
    });

    it("restores collapsed state from localStorage on remount", async () => {
      window.localStorage.setItem("briefing:section:bills:expanded", "false");
      render(
        <BriefingSection slug="bills" title="Bills" seeAllHref="/region/bills">
          <p>body content</p>
        </BriefingSection>,
      );
      // The useEffect that reads storage fires after mount; assert on
      // the post-effect state by waiting for the expand-aria button.
      expect(
        await screen.findByRole("button", { name: /expand bills section/i }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("body content")).not.toBeVisible();
    });

    it("toggles back to expanded and persists the new state", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem("briefing:section:reps:expanded", "false");
      render(
        <BriefingSection
          slug="reps"
          title="Reps"
          seeAllHref="/region/representatives"
        >
          <p>body content</p>
        </BriefingSection>,
      );

      const toggle = await screen.findByRole("button", {
        name: /expand reps section/i,
      });
      await user.click(toggle);

      expect(
        screen.getByRole("button", { name: /collapse reps section/i }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(
        window.localStorage.getItem("briefing:section:reps:expanded"),
      ).toBe("true");
    });

    it("surfaces the item count in the header when collapsed", async () => {
      const user = userEvent.setup();
      render(
        <BriefingSection
          slug="bills"
          title="Bills"
          seeAllHref="/region/bills"
          itemCount={3}
        >
          <p>body</p>
        </BriefingSection>,
      );

      // Expanded: count is hidden so the heading reads cleanly.
      expect(screen.queryByText(/3 items/i)).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /collapse bills section/i }),
      );

      // Collapsed: the count appears so the header isn't information-free.
      expect(screen.getByText(/3 items/i)).toBeInTheDocument();
    });

    it("survives a localStorage write failure without breaking the toggle", async () => {
      // Private-mode Safari / blocked storage scenarios.
      const setItem = jest
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("QuotaExceededError");
        });
      const user = userEvent.setup();
      render(
        <BriefingSection
          slug="committees"
          title="Committees"
          seeAllHref="/region/committees"
        >
          <p>body</p>
        </BriefingSection>,
      );

      await user.click(
        screen.getByRole("button", { name: /collapse committees section/i }),
      );

      // Toggle still flipped despite the storage write failure.
      expect(
        screen.getByRole("button", { name: /expand committees section/i }),
      ).toHaveAttribute("aria-expanded", "false");
      setItem.mockRestore();
    });

    it("uses different localStorage keys per slug so sections collapse independently", async () => {
      const user = userEvent.setup();
      render(
        <>
          <BriefingSection
            slug="bills"
            title="Bills"
            seeAllHref="/region/bills"
          >
            <p>bills body</p>
          </BriefingSection>
          <BriefingSection
            slug="reps"
            title="Reps"
            seeAllHref="/region/representatives"
          >
            <p>reps body</p>
          </BriefingSection>
        </>,
      );

      await user.click(
        screen.getByRole("button", { name: /collapse bills section/i }),
      );

      // Only bills collapsed; reps still expanded.
      expect(screen.getByText("bills body")).not.toBeVisible();
      expect(screen.getByText("reps body")).toBeVisible();
      expect(
        window.localStorage.getItem("briefing:section:bills:expanded"),
      ).toBe("false");
      expect(
        window.localStorage.getItem("briefing:section:reps:expanded"),
      ).toBeNull();
    });
  });
});
