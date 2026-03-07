import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PetitionHistoryPage from "@/app/petition/history/page";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock react-i18next
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

// Mock toast
jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// Mock Apollo hooks
const mockRefetch = jest.fn();
const mockSoftDeleteScan = jest.fn();
const mockDeleteAllMyScans = jest.fn();

let mockQueryResult: {
  data: unknown;
  loading: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock("@apollo/client/react", () => ({
  ...jest.requireActual("@apollo/client/react"),
  useQuery: jest.fn(() => mockQueryResult),
  useMutation: jest.fn((mutation) => {
    const mutationName = mutation?.definitions?.[0]?.name?.value;
    if (mutationName === "SoftDeleteScan") {
      return [mockSoftDeleteScan, { loading: false }];
    }
    if (mutationName === "DeleteAllMyScans") {
      return [mockDeleteAllMyScans, { loading: false }];
    }
    return [jest.fn(), { loading: false }];
  }),
}));

const mockItems = [
  {
    id: "doc-1",
    type: "petition",
    status: "ai_analysis_complete",
    summary: "Reform criminal sentencing",
    ocrConfidence: 95.5,
    hasAnalysis: true,
    createdAt: "2024-06-15T10:00:00Z",
  },
  {
    id: "doc-2",
    type: "petition",
    status: "text_extraction_complete",
    summary: null,
    ocrConfidence: 80.0,
    hasAnalysis: false,
    createdAt: "2024-06-10T10:00:00Z",
  },
];

describe("PetitionHistoryPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: {
        myScanHistory: {
          items: mockItems,
          total: 2,
          hasMore: false,
        },
      },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
  });

  it("should render scan history items", () => {
    render(<PetitionHistoryPage />);

    expect(screen.getByText("Reform criminal sentencing")).toBeInTheDocument();
    expect(screen.getByText("history.title")).toBeInTheDocument();
  });

  it("should show status badges", () => {
    render(<PetitionHistoryPage />);

    expect(screen.getByText("history.analyzed")).toBeInTheDocument();
    expect(screen.getByText("history.pending")).toBeInTheDocument();
  });

  it("should show empty state when no scans", () => {
    mockQueryResult = {
      data: { myScanHistory: { items: [], total: 0, hasMore: false } },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };

    render(<PetitionHistoryPage />);

    expect(screen.getByText("history.noScans")).toBeInTheDocument();
    expect(screen.getByText("history.noScansDescription")).toBeInTheDocument();
  });

  it("should show loading spinner when loading", () => {
    mockQueryResult = {
      data: null,
      loading: true,
      error: null,
      refetch: mockRefetch,
    };

    render(<PetitionHistoryPage />);

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("should show error state", () => {
    mockQueryResult = {
      data: null,
      loading: false,
      error: { message: "Network error" },
      refetch: mockRefetch,
    };

    render(<PetitionHistoryPage />);

    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("should show pagination when items exist", () => {
    render(<PetitionHistoryPage />);

    expect(screen.getByText("history.previous")).toBeInTheDocument();
    expect(screen.getByText("history.next")).toBeInTheDocument();
  });

  it("should show delete all button when items exist", () => {
    render(<PetitionHistoryPage />);

    expect(screen.getByText("history.deleteAllScans")).toBeInTheDocument();
  });

  it("should open delete confirmation dialog", () => {
    render(<PetitionHistoryPage />);

    const deleteButtons = screen.getAllByLabelText("history.deleteScan");
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText("history.deleteConfirm")).toBeInTheDocument();
  });

  it("should have search input", () => {
    render(<PetitionHistoryPage />);

    expect(screen.getByPlaceholderText("history.search")).toBeInTheDocument();
  });

  it("should link items to detail page", () => {
    render(<PetitionHistoryPage />);

    const links = screen.getAllByRole("link");
    const historyLink = links.find(
      (l) => l.getAttribute("href") === "/petition/history/doc-1",
    );
    expect(historyLink).toBeInTheDocument();
  });
});
