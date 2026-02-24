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

// Mock Apollo Client mutations
const mockProcessScan = jest.fn();
const mockAnalyzeDocument = jest.fn();
const mockSetDocumentLocation = jest.fn();

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

    expect(screen.getByText("results.saveToTrack")).toBeInTheDocument();
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
});
