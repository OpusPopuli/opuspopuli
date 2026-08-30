import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AnalysisDisplay } from "@/components/petition/AnalysisDisplay";
import type {
  DocumentAnalysis,
  LinkedProposition,
} from "@/lib/graphql/documents";

// Mock react-i18next
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        let result = key;
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{{${k}}}`, v);
        }
        return result;
      }
      return key;
    },
  }),
}));

const baseAnalysis: DocumentAnalysis = {
  documentType: "petition",
  summary: "This petition seeks to reform criminal sentencing.",
  keyPoints: ["Reduces penalties", "Reclassifies offenses"],
  entities: ["State Legislature", "Department of Justice"],
  analyzedAt: new Date().toISOString(),
  provider: "Ollama",
  model: "llama3.2",
  processingTimeMs: 1500,
  actualEffect: "Would reduce prison populations",
  potentialConcerns: ["May increase recidivism"],
  beneficiaries: ["Non-violent offenders"],
  potentiallyHarmed: ["Victims advocacy groups"],
  relatedMeasures: ["Proposition 47"],
};

describe("AnalysisDisplay", () => {
  it("should render summary and key points", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} />);

    expect(screen.getByText(baseAnalysis.summary)).toBeInTheDocument();
    expect(screen.getByText("Reduces penalties")).toBeInTheDocument();
    expect(screen.getByText("Reclassifies offenses")).toBeInTheDocument();
  });

  it("should render actual effect section", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} />);

    expect(
      screen.getByText("Would reduce prison populations"),
    ).toBeInTheDocument();
  });

  it("should render concerns, beneficiaries, and potentially harmed", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} />);

    expect(screen.getByText("May increase recidivism")).toBeInTheDocument();
    expect(screen.getByText(/Non-violent offenders/)).toBeInTheDocument();
    expect(screen.getByText(/Victims advocacy groups/)).toBeInTheDocument();
  });

  it("should render entities as badges", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} />);

    expect(screen.getByText("State Legislature")).toBeInTheDocument();
    expect(screen.getByText("Department of Justice")).toBeInTheDocument();
  });

  it("should render linked propositions as clickable cards", () => {
    const linkedProps: LinkedProposition[] = [
      {
        id: "link-1",
        propositionId: "prop-1",
        title: "Proposition 47",
        summary: "Criminal sentencing reform",
        status: "PENDING",
        linkSource: "auto_analysis",
        confidence: 0.8,
        matchedText: "Proposition 47",
        linkedAt: new Date().toISOString(),
      },
    ];

    render(
      <AnalysisDisplay
        analysis={baseAnalysis}
        linkedPropositions={linkedProps}
      />,
    );

    expect(screen.getByText("Proposition 47")).toBeInTheDocument();
    expect(screen.getByText("results.linkedAutomatically")).toBeInTheDocument();
  });

  it("does not surface the raw OCR text (jumbled/low-confidence, misleading)", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} />);

    // No editable OCR field, and the extracted-text heading is gone.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("results.extractedText")).not.toBeInTheDocument();
  });

  it("should show provider info footer", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} />);

    expect(screen.getByText(/results\.analyzedBy/)).toBeInTheDocument();
  });

  it("should show cached result indicator when fromCache is true", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} fromCache />);

    expect(screen.getByText(/results\.cachedResult/)).toBeInTheDocument();
  });

  it("should show completeness bar when score is present", () => {
    const analysisWithCompleteness = {
      ...baseAnalysis,
      completenessScore: 80,
      completenessDetails: {
        availableCount: 4,
        idealCount: 5,
        missingItems: ["Financial impact data"],
        explanation: "Based on 4 of 5 sources",
      },
    };

    render(<AnalysisDisplay analysis={analysisWithCompleteness} />);

    expect(screen.getByText("results.completenessScore")).toBeInTheDocument();
  });

  it("should handle empty key points array", () => {
    const analysis = { ...baseAnalysis, keyPoints: [] };

    render(<AnalysisDisplay analysis={analysis} />);

    // Summary should still render
    expect(
      screen.getByText("This petition seeks to reform criminal sentencing."),
    ).toBeInTheDocument();
  });

  it("should handle empty entities array", () => {
    const analysis = { ...baseAnalysis, entities: [] };

    render(<AnalysisDisplay analysis={analysis} />);

    expect(
      screen.getByText("This petition seeks to reform criminal sentencing."),
    ).toBeInTheDocument();
  });

  it("should handle missing summary gracefully", () => {
    const analysis = { ...baseAnalysis, summary: "" };

    render(<AnalysisDisplay analysis={analysis} />);

    // Should still render without errors
    expect(screen.getByText("results.keyPoints")).toBeInTheDocument();
  });

  it("should not render linked propositions section when list is empty", () => {
    render(<AnalysisDisplay analysis={baseAnalysis} linkedPropositions={[]} />);

    expect(
      screen.queryByText("results.relatedBallotMeasures"),
    ).not.toBeInTheDocument();
  });
  /**
   * #1074 added a third link source. Before this, anything that was not
   * `auto_analysis` fell through to "linked manually" — so a retrieval match,
   * made by measured similarity with no human involved, would have claimed a
   * person made it.
   */
  describe("link source labelling (#1074)", () => {
    const linked = (linkSource: string) => [
      {
        id: "l1",
        propositionId: "p1",
        title: "A MEASURE",
        summary: "Summary.",
        status: "circulating",
        linkSource,
        linkedAt: "2026-08-30T00:00:00Z",
      },
    ];

    it("labels a retrieval match as matched, not manual", () => {
      render(
        <AnalysisDisplay
          analysis={baseAnalysis}
          linkedPropositions={linked("auto_retrieval") as never}
        />,
      );

      expect(
        screen.queryByText("results.linkedManually"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("results.linkedByMatch")).toBeInTheDocument();
    });

    it("still labels the legacy substring match as automatic", () => {
      render(
        <AnalysisDisplay
          analysis={baseAnalysis}
          linkedPropositions={linked("auto_analysis") as never}
        />,
      );

      expect(
        screen.getByText("results.linkedAutomatically"),
      ).toBeInTheDocument();
    });

    it("still labels a human link as manual", () => {
      render(
        <AnalysisDisplay
          analysis={baseAnalysis}
          linkedPropositions={linked("user_manual") as never}
        />,
      );

      expect(screen.getByText("results.linkedManually")).toBeInTheDocument();
    });
  });
});
