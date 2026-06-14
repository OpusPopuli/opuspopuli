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

// `signals` is required on the panel (#750). Tests that aren't about
// signal rendering pass an empty array — the panel hides the signals
// section when empty, mirroring the zero-relevance feed entry case.
const NO_SIGNALS = [] as const;

describe("WhyThisPanel", () => {
  it("starts collapsed; clicking expands the panel", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={{ ...baseAxes, directMaterial: 0.8 }}
        scopeId="bill-1"
        signals={NO_SIGNALS}
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
        signals={NO_SIGNALS}
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
        signals={NO_SIGNALS}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/topics you said you care about/i),
    ).toBeInTheDocument();
  });

  it("omits the axis sentence when every axis is zero (theoretical 4-7-only surfacing)", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={baseAxes}
        scopeId="bill-zero"
        signals={NO_SIGNALS}
      />,
    );
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
        signals={NO_SIGNALS}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/llm explanation pipeline ships/i),
    ).toBeInTheDocument();
  });

  it("renders the LLM explanation (and hides the heuristic) when llmExplanation is supplied (#745)", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={{ ...baseAxes, directMaterial: 0.9 }}
        scopeId="bill-llm"
        llmExplanation="Caps rent for renters in 94110 by 3% — affects your housing costs."
        signals={NO_SIGNALS}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/Caps rent for renters in 94110 by 3%/i),
    ).toBeInTheDocument();
    // The heuristic axis sentence + #745 placeholder are hidden when the
    // LLM line is present — they exist only as the fallback.
    expect(
      screen.queryByText(/money, rights, health, or services/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/llm explanation pipeline ships/i),
    ).not.toBeInTheDocument();
  });

  it("falls back to the heuristic axis explanation when llmExplanation is empty string", async () => {
    const user = userEvent.setup();
    render(
      <WhyThisPanel
        axisScores={{ ...baseAxes, directMaterial: 0.9 }}
        scopeId="bill-empty"
        llmExplanation=""
        signals={NO_SIGNALS}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/money, rights, health, or services/i),
    ).toBeInTheDocument();
  });

  it("scopes aria-controls with the supplied scopeId so multiple cards stay isolated", () => {
    render(
      <WhyThisPanel
        axisScores={baseAxes}
        scopeId="bill-42"
        signals={NO_SIGNALS}
      />,
    );
    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-controls", "why-bill-42");
  });

  describe("contributingSignals (#750)", () => {
    it("renders a bullet for each signal with the translated label", async () => {
      const user = userEvent.setup();
      render(
        <WhyThisPanel
          axisScores={{ ...baseAxes, directMaterial: 0.4 }}
          scopeId="bill-signals"
          signals={[
            {
              type: "flag",
              key: "isRenter",
              axis: "directMaterial",
              isSensitive: false,
            },
            {
              type: "flag",
              key: "isParent",
              axis: "directMaterial",
              isSensitive: false,
            },
            {
              type: "actionability",
              key: "within_30_days",
              axis: "actionability",
              isSensitive: false,
            },
          ]}
        />,
      );
      await user.click(screen.getByRole("button"));
      expect(screen.getByText(/signals that contributed/i)).toBeInTheDocument();
      expect(screen.getByText(/you're a renter/i)).toBeInTheDocument();
      expect(screen.getByText(/you're a parent/i)).toBeInTheDocument();
      expect(
        screen.getByText(/action within the last 30 days/i),
      ).toBeInTheDocument();
    });

    it("falls back to the slug when no i18n label matches (unknown flag)", async () => {
      const user = userEvent.setup();
      render(
        <WhyThisPanel
          axisScores={baseAxes}
          scopeId="bill-unknown-flag"
          signals={[
            {
              type: "flag",
              key: "isFutureFlag",
              axis: "directMaterial",
              isSensitive: false,
            },
          ]}
        />,
      );
      await user.click(screen.getByRole("button"));
      // humanizeSlug("isFutureFlag") -> "Is future flag"
      expect(screen.getByText(/is future flag/i)).toBeInTheDocument();
    });

    it("renders interest-tag signals using the raw slug (open-set taxonomy)", async () => {
      const user = userEvent.setup();
      render(
        <WhyThisPanel
          axisScores={baseAxes}
          scopeId="bill-interest"
          signals={[
            {
              type: "interest_tag",
              key: "housing",
              axis: "valuesAlignment",
              isSensitive: false,
            },
          ]}
        />,
      );
      await user.click(screen.getByRole("button"));
      expect(screen.getByText(/housing/i)).toBeInTheDocument();
    });

    it("collapses T3-derived (isSensitive) signals to a single neutral label and never names the trait (#750 AC)", async () => {
      const user = userEvent.setup();
      render(
        <WhyThisPanel
          axisScores={{ ...baseAxes, directMaterial: 0.4 }}
          scopeId="bill-sensitive"
          signals={[
            {
              type: "flag",
              key: "isVeteran",
              axis: "directMaterial",
              isSensitive: true,
            },
            {
              type: "flag",
              key: "hasImmigrationConcern",
              axis: "directMaterial",
              isSensitive: true,
            },
          ]}
        />,
      );
      await user.click(screen.getByRole("button"));
      // The neutral label renders once per sensitive signal — the
      // specific T3 identity must NEVER appear in the DOM.
      const sensitiveItems = screen.getAllByText(
        /a sensitive signal you shared/i,
      );
      expect(sensitiveItems).toHaveLength(2);
      expect(screen.queryByText(/you're a veteran/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/immigration as a concern/i),
      ).not.toBeInTheDocument();
    });

    it("hides the signals section when the array is empty", async () => {
      const user = userEvent.setup();
      render(
        <WhyThisPanel
          axisScores={{ ...baseAxes, directMaterial: 0.7 }}
          scopeId="bill-empty-signals"
          signals={[]}
        />,
      );
      await user.click(screen.getByRole("button"));
      expect(
        screen.queryByText(/signals that contributed/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("sourceDocumentUrl (#750)", () => {
    it("renders a 'Read the source' link with the supplied URL", async () => {
      const user = userEvent.setup();
      render(
        <WhyThisPanel
          axisScores={{ ...baseAxes, directMaterial: 0.5 }}
          scopeId="bill-src"
          sourceDocumentUrl="https://leginfo.legislature.ca.gov/AB1234"
          signals={NO_SIGNALS}
        />,
      );
      await user.click(screen.getByRole("button"));
      const link = screen.getByRole("link", { name: /read the source/i });
      expect(link).toHaveAttribute(
        "href",
        "https://leginfo.legislature.ca.gov/AB1234",
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("hides the source link when the URL is missing", async () => {
      const user = userEvent.setup();
      render(
        <WhyThisPanel
          axisScores={{ ...baseAxes, directMaterial: 0.5 }}
          scopeId="bill-no-src"
          signals={NO_SIGNALS}
        />,
      );
      await user.click(screen.getByRole("button"));
      expect(
        screen.queryByRole("link", { name: /read the source/i }),
      ).not.toBeInTheDocument();
    });
  });
});
