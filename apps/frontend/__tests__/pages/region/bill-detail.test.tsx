import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BillDetailPage from "@/app/region/bills/[id]/page";
import type {
  CivicsLifecycleStage,
  CivicsMeasureType,
} from "@/lib/graphql/region";

const makeStage = (id: string, name: string): CivicsLifecycleStage => ({
  id,
  name: {
    verbatim: name,
    plainLanguage: name,
    sourceUrl: "https://example.gov",
  },
  shortDescription: {
    verbatim: `${name} short`,
    plainLanguage: `${name} short`,
    sourceUrl: "https://example.gov",
  },
  longDescription: undefined,
  statusStringPatterns: [],
  citizenAction: undefined,
});

const ALL_STAGES: CivicsLifecycleStage[] = [
  makeStage("introduction", "Introduction"),
  makeStage("policy-committee", "Policy Committee"),
  makeStage("third-reading", "Third Reading"),
  makeStage("governor-action", "Governor Action"),
  makeStage("chaptered", "Chaptered"),
  makeStage("failed-passage", "Failed"),
];

const AB_MEASURE_TYPE: CivicsMeasureType = {
  code: "AB",
  name: "Assembly Bill",
  chamber: "Assembly",
  votingThreshold: "majority",
  reachesGovernor: true,
  purpose: {
    verbatim: "General legislation",
    plainLanguage: "General legislation",
    sourceUrl: "https://example.gov",
  },
  lifecycleStageIds: [
    "introduction",
    "policy-committee",
    "third-reading",
    "governor-action",
    // Intentionally omits chaptered + failed-passage — reproduces the bug
  ],
};

const mockBill = {
  id: "bill-1",
  externalId: "20252026AB100",
  billNumber: "AB 100",
  sessionYear: "2025-2026",
  measureTypeCode: "AB",
  title: "Test Bill",
  subject: "Testing",
  status: "Chaptered by Secretary of State",
  currentStageId: "chaptered",
  lastAction: "Signed by Governor",
  lastActionDate: "2025-10-01T00:00:00Z",
  fiscalImpact: null,
  fullTextUrl: null,
  authorId: null, // null authorId → name renders as plain text, not a link
  authorName: "Jane Smith",
  sourceUrl:
    "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=100",
  extractedAt: "2025-10-02T00:00:00Z",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-10-02T00:00:00Z",
  votes: [],
  coAuthors: [],
};

let mockQueryResult: {
  data: { bill: typeof mockBill | null } | null;
  loading: boolean;
  error: Error | null;
} = { data: { bill: mockBill }, loading: false, error: null };

jest.mock("@apollo/client/react", () => ({
  useQuery: jest.fn(() => mockQueryResult),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({ id: "bill-1" })),
}));

jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  };
});

// Provide civics context with the full stage list and a measure type whose
// lifecycleStageIds omits the terminal stages — mirrors the production bug.
jest.mock("@/components/civics/CivicsContext", () => ({
  useCivics: jest.fn(() => ({
    civics: {
      lifecycleStages: ALL_STAGES,
      measureTypes: [AB_MEASURE_TYPE],
      chambers: [],
      glossary: [],
    },
    measureTypeByCode: new Map([["AB", AB_MEASURE_TYPE]]),
    glossaryMap: new Map(),
    glossaryByTerm: new Map(),
    loading: false,
  })),
}));

describe("BillDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = { data: { bill: mockBill }, loading: false, error: null };
  });

  it("shows loading skeleton", () => {
    mockQueryResult = { data: null, loading: true, error: null };
    render(<BillDetailPage />);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
  });

  it("shows error state", () => {
    mockQueryResult = { data: null, loading: false, error: new Error("oops") };
    render(<BillDetailPage />);
    expect(
      screen.getByText("Failed to load bill. Please try again later."),
    ).toBeInTheDocument();
  });

  it("shows not-found state when bill is null", () => {
    mockQueryResult = { data: { bill: null }, loading: false, error: null };
    render(<BillDetailPage />);
    expect(screen.getByText("Bill not found.")).toBeInTheDocument();
  });

  it("renders bill number and title", () => {
    render(<BillDetailPage />);
    expect(screen.getAllByText("AB 100").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Test Bill")).toBeInTheDocument();
  });

  describe("lifecycle progress bar — terminal stage fallback (regression #694)", () => {
    it("renders the lifecycle bar when currentStageId is a terminal stage absent from measureType.lifecycleStageIds", () => {
      // Bill is chaptered; AB's lifecycleStageIds omits chaptered — without the
      // fallback the bar would silently receive an empty stage list and not render.
      render(<BillDetailPage />);
      expect(
        screen.getByRole("navigation", { name: /Bill lifecycle stages/i }),
      ).toBeInTheDocument();
    });

    it("marks the terminal stage as aria-current='step' via the full-stage fallback", () => {
      render(<BillDetailPage />);
      const items = screen.getAllByRole("listitem");
      const current = items.find(
        (el) => el.getAttribute("aria-current") === "step",
      );
      expect(current).toBeInTheDocument();
    });

    it("shows all stages including chaptered and failed when falling back to full list", () => {
      render(<BillDetailPage />);
      expect(screen.getByText("Chaptered")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
  });

  describe("history tab (#666)", () => {
    it("exposes a History tab in the layer navigation", () => {
      render(<BillDetailPage />);
      expect(
        screen.getByRole("button", { name: /^History$/ }),
      ).toBeInTheDocument();
    });

    it("renders the BillActivityFeed when the History tab is selected", () => {
      render(<BillDetailPage />);
      fireEvent.click(screen.getByRole("button", { name: /^History$/ }));
      expect(screen.getByTestId("bill-activity-feed")).toBeInTheDocument();
    });
  });
});
