import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import SettingsScansPage from "@/app/settings/scans/page";

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
    isPetition: true,
    createdAt: "2026-06-15T10:00:00Z",
  },
  {
    id: "doc-2",
    type: "petition",
    status: "text_extraction_complete",
    summary: null,
    ocrConfidence: 80.0,
    hasAnalysis: false,
    isPetition: true,
    createdAt: "2026-06-10T10:00:00Z",
  },
  {
    id: "doc-3",
    type: "petition",
    status: "ai_analysis_complete",
    summary: "A restaurant menu",
    ocrConfidence: 71.0,
    hasAnalysis: true,
    isPetition: false,
    createdAt: "2026-06-05T10:00:00Z",
  },
  {
    id: "doc-4",
    type: "petition",
    status: "ocr_failed",
    summary: null,
    ocrConfidence: null,
    hasAnalysis: false,
    isPetition: true,
    createdAt: "2026-06-01T10:00:00Z",
  },
];

interface QueryOverrides {
  total?: number;
  hasMore?: boolean;
  loading?: boolean;
  error?: unknown;
}

function setQuery(
  items: unknown[],
  {
    total = items.length,
    hasMore = false,
    loading = false,
    error = null,
  }: QueryOverrides = {},
) {
  mockQueryResult = {
    data: { myScanHistory: { items, total, hasMore } },
    loading,
    error,
    refetch: mockRefetch,
  };
}

describe("SettingsScansPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setQuery(mockItems);
  });

  it("renders each scan with its status pill", () => {
    render(<SettingsScansPage />);

    expect(screen.getByText("Reform criminal sentencing")).toBeInTheDocument();
    expect(screen.getByText("scans.analyzed")).toBeInTheDocument();
    expect(screen.getByText("scans.pending")).toBeInTheDocument();
    expect(screen.getByText("scans.failed")).toBeInTheDocument();
  });

  /**
   * #1057 verdict honesty carried onto the settings surface: a rejected scan
   * must not borrow the summary or read as "analyzed", even though
   * hasAnalysis is true for it.
   */
  it("shows a non-petition scan as rejected, not analyzed", () => {
    render(<SettingsScansPage />);

    expect(screen.getByText("scans.notAPetitionItem")).toBeInTheDocument();
    expect(screen.queryByText("A restaurant menu")).not.toBeInTheDocument();
    expect(screen.getByText("scans.notAPetition")).toBeInTheDocument();
  });

  it("links each row to the settings-scoped detail route", () => {
    render(<SettingsScansPage />);

    const links = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));

    expect(links).toContain("/settings/scans/doc-1");
    expect(links.some((h) => h?.startsWith("/petition/history"))).toBe(false);
  });

  it("renders the empty state with a scan call to action", () => {
    setQuery([], { total: 0 });
    render(<SettingsScansPage />);

    expect(screen.getByText("scans.noScans")).toBeInTheDocument();
    expect(screen.getByText("scans.scanAgain")).toBeInTheDocument();
  });

  it("offers a retry when the query fails", () => {
    setQuery([], { total: 0, error: new Error("boom") });
    render(<SettingsScansPage />);

    expect(screen.getByText("scans.loadError")).toBeInTheDocument();
    fireEvent.click(screen.getByText("common:buttons.retry"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("hides pagination when everything fits on one page", () => {
    render(<SettingsScansPage />);

    expect(screen.queryByText("scans.previous")).not.toBeInTheDocument();
    expect(screen.queryByText("scans.next")).not.toBeInTheDocument();
  });

  it("shows pagination, with Previous disabled on the first page", () => {
    setQuery(mockItems, { total: 24, hasMore: true });
    render(<SettingsScansPage />);

    expect(screen.getByText("scans.previous")).toBeDisabled();
    expect(screen.getByText("scans.next")).toBeEnabled();
    // The t() mock interpolates into the key, which carries no placeholders,
    // so this asserts the counter renders — not its formatting.
    expect(screen.getByText("scans.showing")).toBeInTheDocument();
  });

  it("confirms before deleting a single scan", async () => {
    render(<SettingsScansPage />);

    fireEvent.click(screen.getAllByLabelText("scans.deleteScan")[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockSoftDeleteScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("scans.delete"));

    await waitFor(() =>
      expect(mockSoftDeleteScan).toHaveBeenCalledWith({
        variables: { documentId: "doc-1" },
      }),
    );
  });

  it("cancels a delete without calling the mutation", () => {
    render(<SettingsScansPage />);

    fireEvent.click(screen.getAllByLabelText("scans.deleteScan")[0]);
    fireEvent.click(screen.getByText("scans.cancel"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockSoftDeleteScan).not.toHaveBeenCalled();
  });

  it("confirms before deleting every scan", async () => {
    render(<SettingsScansPage />);

    fireEvent.click(screen.getByText("scans.deleteAllScans"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // The confirm button reuses the same label, so target the dialog's copy.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("scans.deleteAllScans"));

    await waitFor(() => expect(mockDeleteAllMyScans).toHaveBeenCalled());
  });
});
