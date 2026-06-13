import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CommitteeBriefingCard } from "@/components/briefing/committees/CommitteeBriefingCard";
import type { CommitteeBriefingItem } from "@/lib/graphql/personalized-committees";

const baseItem: CommitteeBriefingItem = {
  id: "c-1",
  externalId: "assembly:judiciary",
  name: "Assembly Judiciary Committee",
  chamber: "Assembly",
  memberCount: 13,
  description: "Reviews civil and criminal procedure legislation.",
  url: null,
  relevanceExplanation:
    "Reviews legislation matching your housing-topic interests across renter protections and tenancy law.",
};

describe("CommitteeBriefingCard (#836)", () => {
  it("returns null when no relevanceExplanation is present (defensive guard against hook contract drift)", () => {
    const { container } = render(
      <CommitteeBriefingCard
        item={{ ...baseItem, relevanceExplanation: null }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the committee name as a link to the committee detail page", () => {
    render(<CommitteeBriefingCard item={baseItem} />);
    const link = screen.getByRole("link", {
      name: /assembly judiciary committee/i,
    });
    expect(link).toHaveAttribute("href", "/region/legislative-committees/c-1");
  });

  it("renders chamber + member count in the metadata line", () => {
    render(<CommitteeBriefingCard item={baseItem} />);
    // The committee name itself contains "Assembly" — scope the assertion
    // to the chamber/member-count line which combines both via i18n.
    expect(screen.getByText(/Assembly · 13 members/i)).toBeInTheDocument();
  });

  it("renders the why-this disclosure toggle with the LLM explanation hidden by default", () => {
    render(<CommitteeBriefingCard item={baseItem} />);
    const toggle = screen.getByRole("button", {
      name: /why is this on my briefing/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Reviews legislation matching/i)).toBeNull();
  });

  it("reveals the LLM explanation when the why-this toggle is clicked", () => {
    render(<CommitteeBriefingCard item={baseItem} />);
    const toggle = screen.getByRole("button", {
      name: /why is this on my briefing/i,
    });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(/Reviews legislation matching your housing-topic/i),
    ).toBeInTheDocument();
  });

  it("scopes the panel id by committee id so multiple cards on the page have distinct ARIA targets", () => {
    const { rerender, container } = render(
      <CommitteeBriefingCard item={baseItem} />,
    );
    expect(container.querySelector("#why-committee-c-1")).toBeNull(); // collapsed by default
    rerender(
      <CommitteeBriefingCard
        item={{ ...baseItem, id: "c-2", relevanceExplanation: "Other reason." }}
      />,
    );
    const toggleC2 = screen.getByRole("button", {
      name: /why is this on my briefing/i,
    });
    expect(toggleC2).toHaveAttribute("aria-controls", "why-committee-c-2");
  });
});
