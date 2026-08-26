import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ScanDetailPage from "@/app/settings/scans/[id]/page";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: "doc-1" }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params) {
        let result = key;
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
      }
      return key;
    },
  }),
}));

jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// The analysis body is covered by its own specs; here it only needs to be
// distinguishable so we can assert which branch rendered.
jest.mock("@/components/petition/AnalysisDisplay", () => ({
  AnalysisDisplay: () => <div data-testid="analysis-display" />,
}));
jest.mock("@/components/petition/NotAPetition", () => ({
  NotAPetition: () => <div data-testid="not-a-petition" />,
}));
jest.mock("@/components/petition/PersonalizedImpact", () => ({
  PersonalizedImpact: () => <div data-testid="personalized-impact" />,
}));
jest.mock("@/components/petition/usePersonalizedImpact", () => ({
  usePersonalizedImpact: jest.fn(() => ({ status: "ready", text: "" })),
}));
jest.mock("@/components/petition/TrackOnBallotButton", () => ({
  TrackOnBallotButton: () => <div data-testid="track-on-ballot" />,
}));
jest.mock("@/components/ReportIssueButton", () => ({
  ReportIssueButton: () => <div data-testid="report-issue" />,
}));

const mockSoftDeleteScan = jest.fn();

let mockDetail: { data: unknown; loading: boolean; error: unknown };

jest.mock("@apollo/client/react", () => ({
  ...jest.requireActual("@apollo/client/react"),
  useQuery: jest.fn((query) => {
    const name = query?.definitions?.[0]?.name?.value;
    if (name === "LinkedPropositions") {
      return { data: { linkedPropositions: [] }, refetch: jest.fn() };
    }
    return { ...mockDetail, refetch: jest.fn() };
  }),
  useMutation: jest.fn(() => [mockSoftDeleteScan, { loading: false }]),
}));

const analysedScan = {
  id: "doc-1",
  type: "petition",
  status: "ai_analysis_complete",
  ocrProvider: "tesseract",
  createdAt: "2026-06-15T10:00:00Z",
  updatedAt: "2026-06-15T10:00:00Z",
  analysis: {
    summary: "Reform criminal sentencing",
    keyPoints: ["One", "Two"],
    entities: [],
    isPetition: true,
  },
};

describe("Settings ScanDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetail = {
      data: { scanDetail: analysedScan },
      loading: false,
      error: null,
    };
  });

  it("renders the analysis with share and track actions", () => {
    render(<ScanDetailPage />);

    expect(screen.getByTestId("analysis-display")).toBeInTheDocument();
    expect(screen.getByTestId("personalized-impact")).toBeInTheDocument();
    expect(screen.getByTestId("track-on-ballot")).toBeInTheDocument();
    expect(screen.getByText("scans.share")).toBeInTheDocument();
  });

  it("points back to the settings list, never the petition shell", () => {
    render(<ScanDetailPage />);

    const hrefs = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/settings/scans");
    expect(hrefs.some((h) => h?.startsWith("/petition/history"))).toBe(false);
  });

  /**
   * #1057: a rejected scan shows the honest rejection state instead of
   * analysis, and must offer neither share nor track. Report and delete stay —
   * report is the false-negative escape hatch.
   */
  it("replaces analysis with the rejection state for a non-petition", () => {
    mockDetail = {
      data: {
        scanDetail: {
          ...analysedScan,
          analysis: { ...analysedScan.analysis, isPetition: false },
        },
      },
      loading: false,
      error: null,
    };
    render(<ScanDetailPage />);

    expect(screen.getByTestId("not-a-petition")).toBeInTheDocument();
    expect(screen.queryByTestId("analysis-display")).not.toBeInTheDocument();
    expect(screen.queryByTestId("track-on-ballot")).not.toBeInTheDocument();
    expect(screen.queryByText("scans.share")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-issue")).toBeInTheDocument();
  });

  it("shows a not-found state when the scan is missing", () => {
    mockDetail = { data: undefined, loading: false, error: null };
    render(<ScanDetailPage />);

    expect(screen.getByText("scans.scanNotFound")).toBeInTheDocument();
    expect(screen.queryByTestId("analysis-display")).not.toBeInTheDocument();
  });

  it("confirms, then deletes and returns to the list", async () => {
    render(<ScanDetailPage />);

    fireEvent.click(screen.getByText("scans.deleteScan"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockSoftDeleteScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("scans.delete"));

    await waitFor(() =>
      expect(mockSoftDeleteScan).toHaveBeenCalledWith({
        variables: { documentId: "doc-1" },
      }),
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/settings/scans"),
    );
  });
});
