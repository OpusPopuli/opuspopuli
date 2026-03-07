import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PetitionResultsPage from "@/app/petition/results/page";

// Mock next/navigation
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

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

// Mock toast
jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// Mock Apollo Client mutations and lazy queries
const mockProcessScan = jest.fn();
const mockAnalyzeDocument = jest.fn();
const mockSetDocumentLocation = jest.fn();
const mockFetchLinkedPropositions = jest.fn();

jest.mock("@apollo/client/react", () => ({
  ...jest.requireActual("@apollo/client/react"),
  useMutation: jest.fn((mutation) => {
    const mutationName = mutation?.definitions?.[0]?.name?.value;
    if (mutationName === "ProcessScan") {
      return [mockProcessScan, { loading: false }];
    }
    if (mutationName === "AnalyzeDocument") {
      return [mockAnalyzeDocument, { loading: false }];
    }
    if (mutationName === "SetDocumentLocation") {
      return [mockSetDocumentLocation, { loading: false }];
    }
    return [jest.fn(), { loading: false }];
  }),
  useLazyQuery: jest.fn(() => [mockFetchLinkedPropositions]),
}));

// Mock TrackOnBallotButton to isolate page tests
jest.mock("@/components/petition/TrackOnBallotButton", () => ({
  TrackOnBallotButton: ({
    documentId,
    linkedCount,
  }: {
    documentId: string;
    linkedCount: number;
    onLinked?: () => void;
  }) => (
    <button data-testid="track-on-ballot" data-doc-id={documentId}>
      {linkedCount > 0
        ? `Tracking ${linkedCount} measure(s)`
        : "Track on Ballot"}
    </button>
  ),
}));

const mockScanResult = {
  data: {
    processScan: {
      documentId: "doc-123",
      text: "We the undersigned petition for change",
      confidence: 95.5,
      provider: "Tesseract",
      processingTimeMs: 1200,
    },
  },
};

const mockAnalysisResult = {
  data: {
    analyzeDocument: {
      analysis: {
        documentType: "petition",
        summary: "A petition calling for policy change",
        keyPoints: ["Requests new regulation", "Requires 10000 signatures"],
        entities: ["City Council", "Department of Parks"],
        analyzedAt: "2025-02-21T00:00:00.000Z",
        provider: "Ollama",
        model: "mistral:7b",
        tokensUsed: 500,
        processingTimeMs: 3000,
        promptVersion: "v3",
        promptHash: "abc123def456789012345678",
        sources: [
          {
            name: "Scanned Document (OCR)",
            accessedAt: new Date().toISOString(),
            dataCompleteness: 100,
          },
          {
            name: "Ollama LLM Analysis (mistral:7b)",
            accessedAt: new Date().toISOString(),
            dataCompleteness: 100,
          },
          {
            name: "Entity Extraction",
            accessedAt: new Date().toISOString(),
            dataCompleteness: 100,
          },
        ],
        completenessScore: 80,
        completenessDetails: {
          availableCount: 4,
          idealCount: 5,
          missingItems: ["Financial impact data"],
          explanation:
            "This analysis is based on 4 of 5 available data sources for this document type.",
        },
        actualEffect: "Would mandate new park maintenance standards",
        potentialConcerns: ["Budget impact unclear"],
        beneficiaries: ["Local residents"],
        potentiallyHarmed: ["Tax payers"],
        relatedMeasures: ["Proposition 15"],
      },
      fromCache: false,
    },
  },
};

describe("PetitionResultsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockProcessScan.mockResolvedValue(mockScanResult);
    mockAnalyzeDocument.mockResolvedValue(mockAnalysisResult);
    mockSetDocumentLocation.mockResolvedValue({
      data: {
        setDocumentLocation: {
          success: true,
          fuzzedLocation: { latitude: 37.77, longitude: -122.42 },
        },
      },
    });
    mockFetchLinkedPropositions.mockResolvedValue({
      data: { linkedPropositions: [] },
    });
  });

  it("should redirect to /petition when no scan data in sessionStorage", () => {
    render(<PetitionResultsPage />);

    expect(mockReplace).toHaveBeenCalledWith("/petition");
  });

  it("should show extraction loading state initially", () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    expect(screen.getByText("results.extractingText")).toBeInTheDocument();
  });

  it("should show OCR text after extraction completes", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("We the undersigned petition for change"),
      ).toBeInTheDocument();
    });
  });

  it("should show confidence badge", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText(/96%/)).toBeInTheDocument();
    });
  });

  it("should show analysis after completion", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("A petition calling for policy change"),
      ).toBeInTheDocument();
    });

    // Check key points
    expect(screen.getByText("Requests new regulation")).toBeInTheDocument();
    expect(screen.getByText("Requires 10000 signatures")).toBeInTheDocument();

    // Check actual effect
    expect(
      screen.getByText("Would mandate new park maintenance standards"),
    ).toBeInTheDocument();

    // Check concerns
    expect(screen.getByText("Budget impact unclear")).toBeInTheDocument();

    // Check beneficiaries
    expect(screen.getByText(/Local residents/)).toBeInTheDocument();

    // Check entities
    expect(screen.getByText("City Council")).toBeInTheDocument();
    expect(screen.getByText("Department of Parks")).toBeInTheDocument();
  });

  it("should show action buttons when complete", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText("results.share")).toBeInTheDocument();
    });

    expect(screen.getByTestId("track-on-ballot")).toBeInTheDocument();
  });

  it("should show error state when processScan fails", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");
    mockProcessScan.mockRejectedValue(new Error("Network error"));

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText("results.errorTitle")).toBeInTheDocument();
    });

    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText("results.backToHome")).toBeInTheDocument();
    expect(screen.getByText("results.tryAgain")).toBeInTheDocument();
  });

  it("should show error state when analyzeDocument fails", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");
    mockAnalyzeDocument.mockRejectedValue(new Error("Analysis timeout"));

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText("results.errorTitle")).toBeInTheDocument();
    });

    expect(screen.getByText("Analysis timeout")).toBeInTheDocument();
  });

  it("should clean up sessionStorage after reading", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");
    sessionStorage.setItem(
      "petition-scan-location",
      JSON.stringify({ latitude: 37.7749, longitude: -122.4194 }),
    );

    render(<PetitionResultsPage />);

    // sessionStorage should be cleared immediately
    await waitFor(() => {
      expect(sessionStorage.getItem("petition-scan-data")).toBeNull();
      expect(sessionStorage.getItem("petition-scan-location")).toBeNull();
    });
  });

  it("should allow editing OCR text", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("We the undersigned petition for change"),
      ).toBeInTheDocument();
    });

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Edited text" } });

    expect(screen.getByDisplayValue("Edited text")).toBeInTheDocument();
  });

  it("should call setDocumentLocation when location is provided", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");
    sessionStorage.setItem(
      "petition-scan-location",
      JSON.stringify({ latitude: 37.7749, longitude: -122.4194 }),
    );

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(mockSetDocumentLocation).toHaveBeenCalledWith({
        variables: {
          input: {
            documentId: "doc-123",
            location: { latitude: 37.7749, longitude: -122.4194 },
          },
        },
      });
    });
  });

  it("should not call setDocumentLocation when no location", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("We the undersigned petition for change"),
      ).toBeInTheDocument();
    });

    expect(mockSetDocumentLocation).not.toHaveBeenCalled();
  });

  it("should navigate to /petition when back button is clicked", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    const user = userEvent.setup();

    render(<PetitionResultsPage />);

    const backButton = screen.getByLabelText("results.back");
    await user.click(backButton);

    expect(mockPush).toHaveBeenCalledWith("/petition");
  });

  it("should show Report Issue button when analysis is complete", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText("report.button")).toBeInTheDocument();
    });
  });

  it("should navigate to /petition/capture when try again is clicked", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");
    mockProcessScan.mockRejectedValue(new Error("Failed"));

    const user = userEvent.setup();

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText("results.tryAgain")).toBeInTheDocument();
    });

    await user.click(screen.getByText("results.tryAgain"));

    expect(mockPush).toHaveBeenCalledWith("/petition/capture");
  });

  it("should display prompt version in footer (#424)", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      // The i18n mock returns the key with {{hash}} replaced
      // t("results.promptVersion", { hash: "abc123de" }) → "results.promptVersion" (key returned as-is since {{hash}} not in key)
      // So look for the key text
      expect(screen.getByText(/results\.promptVersion/)).toBeInTheDocument();
    });

    // Prompt Charter link should be present
    expect(screen.getByText("results.promptCharter")).toBeInTheDocument();
    expect(
      screen.getByText("results.promptCharter").closest("a"),
    ).toHaveAttribute("href", "/transparency/prompt-charter");
  });

  it("should display data sources section (#423)", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText("results.dataSources")).toBeInTheDocument();
    });

    // Expand the collapsible sources section
    fireEvent.click(screen.getByText("results.dataSources"));

    // Should show source names
    expect(screen.getByText("Scanned Document (OCR)")).toBeInTheDocument();
    expect(
      screen.getByText("Ollama LLM Analysis (mistral:7b)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Entity Extraction")).toBeInTheDocument();
  });

  it("should display completeness score and progress bar (#425)", async () => {
    sessionStorage.setItem("petition-scan-data", "dGVzdA==");

    render(<PetitionResultsPage />);

    await waitFor(() => {
      expect(screen.getByText("results.dataCompleteness")).toBeInTheDocument();
    });

    // Score should be shown
    expect(screen.getByText("results.completenessScore")).toBeInTheDocument();

    // Missing items should be in a collapsible
    expect(screen.getByText("results.whatWouldImprove")).toBeInTheDocument();

    // Expand and check missing items
    fireEvent.click(screen.getByText("results.whatWouldImprove"));
    expect(screen.getByText("Financial impact data")).toBeInTheDocument();
  });

  describe("completeness color branches (#425)", () => {
    const makeAnalysisWithScore = (score: number) => ({
      data: {
        analyzeDocument: {
          analysis: {
            ...mockAnalysisResult.data.analyzeDocument.analysis,
            completenessScore: score,
            completenessDetails: {
              availableCount: Math.round((score / 100) * 5),
              idealCount: 5,
              missingItems: score < 100 ? ["Missing item"] : [],
              explanation: "test",
            },
          },
          fromCache: false,
        },
      },
    });

    it("should show green progress bar when completeness > 80%", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue(makeAnalysisWithScore(90));

      const { container } = render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("results.dataCompleteness"),
        ).toBeInTheDocument();
      });

      // Check for green class on progress bar
      const progressBar = container.querySelector(".bg-green-500");
      expect(progressBar).toBeInTheDocument();
      // Check for green text
      const scoreText = container.querySelector(".text-green-400");
      expect(scoreText).toBeInTheDocument();
    });

    it("should show yellow progress bar when completeness is 50-80%", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue(makeAnalysisWithScore(60));

      const { container } = render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("results.dataCompleteness"),
        ).toBeInTheDocument();
      });

      const progressBar = container.querySelector(".bg-yellow-500");
      expect(progressBar).toBeInTheDocument();
      const scoreText = container.querySelector(".text-yellow-400");
      expect(scoreText).toBeInTheDocument();
    });

    it("should show red progress bar when completeness < 50%", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue(makeAnalysisWithScore(30));

      const { container } = render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("results.dataCompleteness"),
        ).toBeInTheDocument();
      });

      const progressBar = container.querySelector(".bg-red-500");
      expect(progressBar).toBeInTheDocument();
      const scoreText = container.querySelector(".text-red-400");
      expect(scoreText).toBeInTheDocument();
    });

    it("should not show completeness section when score is null", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue({
        data: {
          analyzeDocument: {
            analysis: {
              ...mockAnalysisResult.data.analyzeDocument.analysis,
              completenessScore: null,
              completenessDetails: null,
            },
            fromCache: false,
          },
        },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.summary")).toBeInTheDocument();
      });

      expect(
        screen.queryByText("results.dataCompleteness"),
      ).not.toBeInTheDocument();
    });

    it("should not show 'what would improve' when no missing items", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue(makeAnalysisWithScore(100));

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("results.dataCompleteness"),
        ).toBeInTheDocument();
      });

      expect(
        screen.queryByText("results.whatWouldImprove"),
      ).not.toBeInTheDocument();
    });
  });

  describe("source freshness branches (#423)", () => {
    it("should show 'Aging' badge for sources accessed 2-7 days ago", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      const threeDaysAgo = new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000,
      ).toISOString();
      mockAnalyzeDocument.mockResolvedValue({
        data: {
          analyzeDocument: {
            analysis: {
              ...mockAnalysisResult.data.analyzeDocument.analysis,
              sources: [
                {
                  name: "Old OCR Source",
                  accessedAt: threeDaysAgo,
                  dataCompleteness: 100,
                },
              ],
            },
            fromCache: false,
          },
        },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.dataSources")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("results.dataSources"));
      expect(screen.getByText("results.sourceAging")).toBeInTheDocument();
    });

    it("should show 'Stale' badge for sources accessed more than 7 days ago", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      const tenDaysAgo = new Date(
        Date.now() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString();
      mockAnalyzeDocument.mockResolvedValue({
        data: {
          analyzeDocument: {
            analysis: {
              ...mockAnalysisResult.data.analyzeDocument.analysis,
              sources: [
                {
                  name: "Stale Source",
                  accessedAt: tenDaysAgo,
                  dataCompleteness: 50,
                },
              ],
            },
            fromCache: false,
          },
        },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.dataSources")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("results.dataSources"));
      expect(screen.getByText("results.sourceStale")).toBeInTheDocument();
    });

    it("should not show sources section when sources array is empty", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue({
        data: {
          analyzeDocument: {
            analysis: {
              ...mockAnalysisResult.data.analyzeDocument.analysis,
              sources: [],
            },
            fromCache: false,
          },
        },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.summary")).toBeInTheDocument();
      });

      expect(screen.queryByText("results.dataSources")).not.toBeInTheDocument();
    });
  });

  describe("share functionality with analysis data", () => {
    it("should share analysis summary via navigator.share including key points", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      const mockShare = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "share", {
        value: mockShare,
        writable: true,
        configurable: true,
      });

      const user = userEvent.setup();

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.share")).toBeInTheDocument();
      });

      await user.click(screen.getByText("results.share"));

      expect(mockShare).toHaveBeenCalledWith({
        title: "Petition Analysis",
        text: expect.stringContaining("A petition calling for policy change"),
      });
      // Verify key points are included in shared text
      const sharedText = mockShare.mock.calls[0][0].text;
      expect(sharedText).toContain("Key Points");
      expect(sharedText).toContain("Requests new regulation");
    });

    it("should gracefully handle share cancellation", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      // Simulate user cancelling share dialog
      Object.defineProperty(navigator, "share", {
        value: jest
          .fn()
          .mockRejectedValue(new DOMException("Share canceled", "AbortError")),
        writable: true,
        configurable: true,
      });

      const user = userEvent.setup();

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.share")).toBeInTheDocument();
      });

      // Should not throw
      await user.click(screen.getByText("results.share"));

      // Page should still be in complete state (no error)
      expect(screen.queryByText("results.errorTitle")).not.toBeInTheDocument();
    });

    it("should not show share button in error state", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockRejectedValue(new Error("LLM timeout"));
      mockProcessScan.mockResolvedValue(mockScanResult);

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.errorTitle")).toBeInTheDocument();
      });

      expect(screen.queryByText("results.share")).not.toBeInTheDocument();
    });
  });

  describe("prompt version edge cases (#424)", () => {
    it("should not show prompt version when promptHash is null", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue({
        data: {
          analyzeDocument: {
            analysis: {
              ...mockAnalysisResult.data.analyzeDocument.analysis,
              promptHash: null,
              promptVersion: null,
            },
            fromCache: false,
          },
        },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.summary")).toBeInTheDocument();
      });

      expect(
        screen.queryByText(/results\.promptVersion/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("results.promptCharter"),
      ).not.toBeInTheDocument();
    });
  });

  describe("cached result display", () => {
    it("should show cached result indicator when fromCache is true", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockAnalyzeDocument.mockResolvedValue({
        data: {
          analyzeDocument: {
            ...mockAnalysisResult.data.analyzeDocument,
            fromCache: true,
          },
        },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText(/results\.cachedResult/)).toBeInTheDocument();
      });
    });
  });

  describe("petition-ballot linking (#310)", () => {
    const mockLinkedPropositions = [
      {
        id: "link-1",
        propositionId: "prop-1",
        title: "Proposition 47: Criminal Sentencing",
        summary: "Reform criminal sentencing guidelines",
        status: "PENDING",
        electionDate: "2024-11-05T00:00:00Z",
        linkSource: "auto_analysis",
        confidence: 0.8,
        matchedText: "Proposition 15",
        linkedAt: new Date().toISOString(),
      },
    ];

    it("should fetch linked propositions after analysis completes", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: { linkedPropositions: [] },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.summary")).toBeInTheDocument();
      });

      expect(mockFetchLinkedPropositions).toHaveBeenCalledWith({
        variables: { documentId: "doc-123" },
      });
    });

    it("should display linked propositions as clickable cards", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: { linkedPropositions: mockLinkedPropositions },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Proposition 47: Criminal Sentencing"),
        ).toBeInTheDocument();
      });

      // Verify it's a link to proposition detail page
      const propLink = screen
        .getByText("Proposition 47: Criminal Sentencing")
        .closest("a");
      expect(propLink).toHaveAttribute("href", "/region/propositions/prop-1");
    });

    it("should show AI-matched badge for auto-analysis links", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: { linkedPropositions: mockLinkedPropositions },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("results.linkedAutomatically"),
        ).toBeInTheDocument();
      });
    });

    it("should show User-linked badge for manual links", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: {
          linkedPropositions: [
            { ...mockLinkedPropositions[0], linkSource: "user_manual" },
          ],
        },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.linkedManually")).toBeInTheDocument();
      });
    });

    it("should show unmatched related measures as text when no linked propositions", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: { linkedPropositions: [] },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.summary")).toBeInTheDocument();
      });

      // relatedMeasures from analysis: ["Proposition 15"]
      expect(screen.getByText(/Proposition 15/)).toBeInTheDocument();
    });

    it("should filter out matched measures from unmatched list", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      // matchedText matches "Proposition 15" from relatedMeasures
      mockFetchLinkedPropositions.mockResolvedValue({
        data: { linkedPropositions: mockLinkedPropositions },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Proposition 47: Criminal Sentencing"),
        ).toBeInTheDocument();
      });

      // The linked proposition card is shown, but the unmatched text item
      // "Proposition 15" should be filtered out since matchedText matches it
      // (The card's matchedText is "Proposition 15" which matches case-insensitively)
      const allElements = screen.queryAllByText(/Proposition 15/);
      // Should not appear as a standalone text item (only in the card if at all)
      // Since the filter uses matchedText.toLowerCase() === m.toLowerCase()
      // and matchedText is "Proposition 15" and related measure is "Proposition 15"
      // it should be filtered out from the unmatched list
      expect(allElements.length).toBe(0);
    });

    it("should pass linkedCount to TrackOnBallotButton", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: { linkedPropositions: mockLinkedPropositions },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByTestId("track-on-ballot")).toBeInTheDocument();
      });

      expect(screen.getByText("Tracking 1 measure(s)")).toBeInTheDocument();
    });

    it("should show Track on Ballot button with 0 count when no links", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: { linkedPropositions: [] },
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByTestId("track-on-ballot")).toBeInTheDocument();
      });

      expect(screen.getByText("Track on Ballot")).toBeInTheDocument();
    });

    it("should handle fetchLinkedPropositions failure gracefully", async () => {
      sessionStorage.setItem("petition-scan-data", "dGVzdA==");
      mockFetchLinkedPropositions.mockResolvedValue({
        data: null,
      });

      render(<PetitionResultsPage />);

      await waitFor(() => {
        expect(screen.getByText("results.summary")).toBeInTheDocument();
      });

      // Should still show the page without errors
      expect(screen.queryByText("results.errorTitle")).not.toBeInTheDocument();
    });
  });
});
