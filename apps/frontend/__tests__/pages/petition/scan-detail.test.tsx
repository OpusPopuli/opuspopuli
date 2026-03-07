import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ScanDetailPage from "@/app/petition/history/[id]/page";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: "doc-123" }),
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

// Mock ReportIssueButton
jest.mock("@/components/ReportIssueButton", () => ({
  ReportIssueButton: ({ documentId }: { documentId: string }) => (
    <button data-testid="report-button" data-doc-id={documentId}>
      Report
    </button>
  ),
}));

// Mock TrackOnBallotButton
jest.mock("@/components/petition/TrackOnBallotButton", () => ({
  TrackOnBallotButton: ({
    documentId,
    linkedCount,
  }: {
    documentId: string;
    linkedCount: number;
  }) => (
    <button data-testid="track-on-ballot" data-doc-id={documentId}>
      {linkedCount > 0 ? `Tracking ${linkedCount}` : "Track on Ballot"}
    </button>
  ),
}));

// Mock Apollo hooks
const mockSoftDeleteScan = jest.fn();
let mockScanDetailResult: {
  data: unknown;
  loading: boolean;
  error: unknown;
};
let mockLinkedResult: {
  data: unknown;
  refetch: jest.Mock;
};

const mockRefetchLinked = jest.fn();

jest.mock("@apollo/client/react", () => ({
  ...jest.requireActual("@apollo/client/react"),
  useQuery: jest.fn((query) => {
    const queryName = query?.definitions?.[0]?.name?.value;
    if (queryName === "ScanDetail") return mockScanDetailResult;
    if (queryName === "GetLinkedPropositions") return mockLinkedResult;
    return { data: null, loading: false, error: null };
  }),
  useLazyQuery: jest.fn(() => [jest.fn()]),
  useMutation: jest.fn(() => [mockSoftDeleteScan, { loading: false }]),
}));

const mockScanDetail = {
  id: "doc-123",
  type: "petition",
  status: "ai_analysis_complete",
  extractedText: "We the undersigned petition for parks",
  ocrConfidence: 95.5,
  ocrProvider: "tesseract",
  analysis: {
    documentType: "petition",
    summary: "This petition seeks to reform parks management.",
    keyPoints: ["Increases park funding"],
    entities: ["City Council"],
    analyzedAt: new Date().toISOString(),
    provider: "Ollama",
    model: "llama3.2",
    processingTimeMs: 1500,
  },
  createdAt: "2024-06-15T10:00:00Z",
  updatedAt: "2024-06-15T10:00:00Z",
};

describe("ScanDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScanDetailResult = {
      data: { scanDetail: mockScanDetail },
      loading: false,
      error: null,
    };
    mockLinkedResult = {
      data: { linkedPropositions: [] },
      refetch: mockRefetchLinked,
    };
  });

  it("should render scan analysis", () => {
    render(<ScanDetailPage />);

    expect(
      screen.getByText("This petition seeks to reform parks management."),
    ).toBeInTheDocument();
    expect(screen.getByText("Increases park funding")).toBeInTheDocument();
  });

  it("should render OCR text as read-only", () => {
    render(<ScanDetailPage />);

    expect(
      screen.getByText("We the undersigned petition for parks"),
    ).toBeInTheDocument();
    // Should NOT have an editable textarea
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("should render action buttons", () => {
    render(<ScanDetailPage />);

    expect(screen.getByText("history.share")).toBeInTheDocument();
    expect(screen.getByTestId("track-on-ballot")).toBeInTheDocument();
    expect(screen.getByTestId("report-button")).toBeInTheDocument();
    expect(screen.getByText("history.delete")).toBeInTheDocument();
  });

  it("should show not found state when scan is null", () => {
    mockScanDetailResult = {
      data: { scanDetail: null },
      loading: false,
      error: null,
    };

    render(<ScanDetailPage />);

    expect(screen.getByText("history.scanNotFound")).toBeInTheDocument();
  });

  it("should show loading spinner while loading", () => {
    mockScanDetailResult = {
      data: null,
      loading: true,
      error: null,
    };

    render(<ScanDetailPage />);

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("should show back button to history", () => {
    render(<ScanDetailPage />);

    expect(screen.getByLabelText("history.backToHistory")).toBeInTheDocument();
  });

  it("should show OCR provider in meta section", () => {
    render(<ScanDetailPage />);

    expect(screen.getByText("OCR: tesseract")).toBeInTheDocument();
  });

  it("should render OCR-only view when no analysis exists", () => {
    mockScanDetailResult = {
      data: {
        scanDetail: {
          ...mockScanDetail,
          analysis: null,
          extractedText: "Some raw OCR text",
        },
      },
      loading: false,
      error: null,
    };

    render(<ScanDetailPage />);

    expect(screen.getByText("Some raw OCR text")).toBeInTheDocument();
    // Share button should not appear without analysis
    expect(screen.queryByText("history.share")).not.toBeInTheDocument();
  });

  it("should call softDeleteScan on delete confirmation", async () => {
    // Mock window.confirm
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    mockSoftDeleteScan.mockResolvedValue({
      data: { softDeleteScan: true },
    });

    render(<ScanDetailPage />);

    const deleteButton = screen.getByText("history.delete");
    deleteButton.click();

    expect(confirmSpy).toHaveBeenCalledWith("history.deleteConfirm");
    expect(mockSoftDeleteScan).toHaveBeenCalledWith({
      variables: { documentId: "doc-123" },
    });

    confirmSpy.mockRestore();
  });

  it("should not delete when confirm is cancelled", () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<ScanDetailPage />);

    const deleteButton = screen.getByText("history.delete");
    deleteButton.click();

    expect(mockSoftDeleteScan).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("should show TrackOnBallotButton with linked count", () => {
    mockLinkedResult = {
      data: {
        linkedPropositions: [
          { id: "link-1", propositionId: "prop-1", title: "Prop 47" },
          { id: "link-2", propositionId: "prop-2", title: "Prop 36" },
        ],
      },
      refetch: mockRefetchLinked,
    };

    render(<ScanDetailPage />);

    expect(screen.getByText("Tracking 2")).toBeInTheDocument();
  });
});
