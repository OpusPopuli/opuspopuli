import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { WhyThisPanel } from "@/components/briefing/bills/WhyThisPanel";
import type { AxisScores } from "@/lib/graphql/personalized-feed";

const baseAxes: AxisScores = {
  directMaterial: 0,
  valuesAlignment: 0,
  actionability: 0,
  indirectMaterial: 0,
  coalitionSignal: 0,
  counterfactual: 0,
  noveltyRepetition: 0,
};

describe("WhyThisPanel", () => {
  it("starts collapsed; clicking expands the panel", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={{ ...baseAxes, directMaterial: 0.8 }}
        scopeId="bill-1"
      />,
    );
    const toggle = screen.getByRole("button", {
      name: /why is this on my briefing/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("picks the top-scoring axis (directMaterial wins over valuesAlignment)", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={{ ...baseAxes, directMaterial: 0.9, valuesAlignment: 0.3 }}
        scopeId="bill-1"
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/money, rights, health, or services/i),
    ).toBeInTheDocument();
  });

  it("picks valuesAlignment when it dominates", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={{ ...baseAxes, directMaterial: 0.1, valuesAlignment: 0.9 }}
        scopeId="bill-2"
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/topics you said you care about/i),
    ).toBeInTheDocument();
  });

  it("omits the axis sentence when every axis is zero (theoretical 4-7-only surfacing)", async () => {
    const user = userEvent.setup();
    render(<WhyThisPanel axisScores={baseAxes} scopeId="bill-zero" />);
    await user.click(screen.getByRole("button"));
    // None of the three axis sentences should render — only the #745 placeholder.
    expect(
      screen.queryByText(/money, rights, health, or services/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/topics you said you care about/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/llm explanation pipeline ships/i),
    ).toBeInTheDocument();
  });

  it("renders the #745 placeholder note inside the expanded panel", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={{ ...baseAxes, actionability: 0.7 }}
        scopeId="bill-3"
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/llm explanation pipeline ships/i),
    ).toBeInTheDocument();
  });

  it("scopes aria-controls with the supplied scopeId so multiple cards stay isolated", () => {
    render(<WhyThisPanel axisScores={baseAxes} scopeId="bill-42" />);
    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-controls", "why-bill-42");
  });
});
