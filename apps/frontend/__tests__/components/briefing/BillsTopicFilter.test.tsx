import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BillsTopicFilter } from "@/components/briefing/bills/BillsTopicFilter";

describe("BillsTopicFilter", () => {
  it("renders one chip per stored interest tag, looking up the i18n label", () => {
    render(<BillsTopicFilter topics={["healthcare", "taxes", "justice"]} />);
    // The labels come from the profile namespace's interestTags options
    // (matching the model-of-me vocab). Spot-check a couple.
    expect(screen.getByText(/healthcare/i)).toBeInTheDocument();
    expect(screen.getByText(/taxes & budget/i)).toBeInTheDocument();
    expect(screen.getByText(/justice reform/i)).toBeInTheDocument();
  });

  it("renders the 'Edit your interests' linkout to /me/profile", () => {
    render(<BillsTopicFilter topics={["healthcare"]} />);
    const link = screen.getByRole("link", { name: /edit your interests/i });
    expect(link).toHaveAttribute("href", "/me/profile");
  });

  it("renders nothing when there are no topics — avoids an empty bar", () => {
    const { container } = render(<BillsTopicFilter topics={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("falls back to the slug when the i18n label is missing", () => {
    render(<BillsTopicFilter topics={["unknown_topic"]} />);
    expect(screen.getByText("unknown_topic")).toBeInTheDocument();
  });
});
