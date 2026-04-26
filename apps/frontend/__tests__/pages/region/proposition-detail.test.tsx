import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PropositionDetailPage from "@/app/region/propositions/[id]/page";

// Mock data — covers the rich-analysis path that Layers 1/2/4 render
// after the proposition-analysis service has run.
const mockProposition = {
  id: "1",
  externalId: "prop-15",
  title: "Tax Reform for Commercial Properties",
  summary:
    "Changes how commercial properties are taxed by requiring reassessment at market value.",
  fullText:
    "This proposition would amend the California Constitution to require commercial and industrial properties worth more than $3 million to be reassessed at current market value.",
  status: "PENDING",
  electionDate: "2024-11-05T00:00:00Z",
  sourceUrl: "https://example.com/prop-15",
  analysisSummary:
    "This measure would reassess commercial and industrial properties worth more than $3 million at market value, generating new state revenue while leaving residential properties untouched.",
  keyProvisions: [
    "Reassesses commercial properties over $3M at market value.",
    "Phases in over three years.",
    "Exempts residential properties.",
  ],
  fiscalImpact: "Estimated $8 billion per year in new state revenue.",
  yesOutcome:
    "A yes vote means commercial properties over $3M get reassessed at market value.",
  noOutcome:
    "A no vote means current Proposition 13 protections remain on commercial properties.",
  existingVsProposed: {
    current: "All real property is taxed based on its 1978 acquisition value.",
    proposed:
      "Commercial and industrial properties over $3M are taxed on current market value.",
  },
  analysisSections: [
    { heading: "Findings", startOffset: 0, endOffset: 80 },
    {
      heading: "Operative Provisions",
      startOffset: 80,
      endOffset: 175,
    },
  ],
  analysisClaims: [],
  analysisSource: "ai-generated",
  analysisGeneratedAt: "2024-01-02T00:00:00Z",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const mockPropositionNoExtras = {
  id: "2",
  externalId: "prop-16",
  title: "Minimal Proposition",
  summary: "A proposition with minimal data.",
  fullText: null,
  status: "PASSED",
  electionDate: null,
  sourceUrl: null,
  analysisSummary: null,
  keyProvisions: null,
  fiscalImpact: null,
  yesOutcome: null,
  noOutcome: null,
  existingVsProposed: null,
  analysisSections: null,
  analysisClaims: null,
  analysisSource: null,
  analysisGeneratedAt: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

let mockQueryResult: {
  data: { proposition: typeof mockProposition | null } | null;
  loading: boolean;
  error: Error | null;
} = {
  data: { proposition: mockProposition },
  loading: false,
  error: null,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: jest.fn(() => mockQueryResult),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({ id: "1" })),
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

// Stub PropositionFundingSection to avoid duplicate useQuery dispatch and
// to keep these tests focused on the page's layer wiring (the funding
// section has its own dedicated unit test).
jest.mock("@/components/region/PropositionFundingSection", () => ({
  PropositionFundingSection: ({ propositionId }: { propositionId: string }) => (
    <div data-testid="funding-section" data-propid={propositionId}>
      [funding section]
    </div>
  ),
}));

describe("PropositionDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { proposition: mockProposition },
      loading: false,
      error: null,
    };
  });

  describe("loading state", () => {
    it("should show loading skeleton", () => {
      mockQueryResult = {
        data: null,
        loading: true,
        error: null,
      };

      render(<PropositionDetailPage />);

      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("should show error message when query fails", () => {
      mockQueryResult = {
        data: null,
        loading: false,
        error: new Error("Failed to fetch"),
      };

      render(<PropositionDetailPage />);

      expect(
        screen.getByText(/Failed to load proposition/i),
      ).toBeInTheDocument();
    });
  });

  describe("not found state", () => {
    it("should show not found when proposition is null", () => {
      mockQueryResult = {
        data: { proposition: null },
        loading: false,
        error: null,
      };

      render(<PropositionDetailPage />);

      expect(screen.getByText("Proposition not found.")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Back to Propositions" }),
      ).toHaveAttribute("href", "/region/propositions");
    });
  });

  describe("Layer 1 - Quick View (default)", () => {
    it("should render proposition header", () => {
      render(<PropositionDetailPage />);

      // externalId appears in both breadcrumb and header
      expect(screen.getAllByText("prop-15").length).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByText("Tax Reform for Commercial Properties"),
      ).toBeInTheDocument();
    });

    it("should render status badge and election date", () => {
      render(<PropositionDetailPage />);

      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(screen.getByText(/Election:/)).toBeInTheDocument();
    });

    it("should render the AI analysis summary (preferred over the raw scrape summary)", () => {
      render(<PropositionDetailPage />);

      // Layer 1 prefers analysisSummary when present and falls back to summary
      // otherwise. With a populated analysisSummary the richer one shows.
      expect(
        screen.getByText(/reassess commercial and industrial properties/i),
      ).toBeInTheDocument();
    });

    it("should fall back to the scrape summary when analysisSummary is missing", () => {
      mockQueryResult = {
        data: { proposition: mockPropositionNoExtras },
        loading: false,
        error: null,
      };

      render(<PropositionDetailPage />);

      expect(
        screen.getByText("A proposition with minimal data."),
      ).toBeInTheDocument();
    });

    it("should show Learn More button", () => {
      render(<PropositionDetailPage />);

      expect(
        screen.getByRole("button", { name: "Learn More" }),
      ).toBeInTheDocument();
    });

    it("should show layer indicator at position 1", () => {
      render(<PropositionDetailPage />);

      const quickViewButton = screen.getByRole("button", {
        name: /Quick View/,
      });
      expect(quickViewButton).toHaveAttribute("aria-current", "step");
    });

    it("should show a fiscal-impact chip when fiscalImpact is populated", () => {
      render(<PropositionDetailPage />);

      // Old "Impact analysis coming soon" placeholder is replaced by a real
      // fiscal-impact chip whenever the analyzer produced a value.
      expect(screen.getByText(/Fiscal impact/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Estimated \$8 billion per year/i),
      ).toBeInTheDocument();
    });
  });

  describe("Layer Navigation", () => {
    it("should navigate to Layer 2 when Learn More is clicked", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: "Learn More" }));

      // Layer 2 leads with the "Key Provisions" section heading.
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Key Provisions" }),
        ).toBeInTheDocument();
      });
    });

    it("should navigate to Layer 3 when See Both Sides is clicked + render the funding section there", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      // Go to Layer 2 first
      await user.click(screen.getByRole("button", { name: "Learn More" }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "See Both Sides" }),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "See Both Sides" }));

      await waitFor(() => {
        expect(
          screen.getByText("Best Arguments From Each Side"),
        ).toBeInTheDocument();
        // Funding section now lives on Layer 3 (it answers "who's behind
        // each side", which fits "Both Sides" better than "Details").
        const section = screen.getByTestId("funding-section");
        expect(section).toBeInTheDocument();
        expect(section).toHaveAttribute("data-propid", "1");
      });
    });

    it("should navigate to Layer 4 when Full Details & Sources is clicked", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      // Navigate to Layer 3
      await user.click(screen.getByRole("button", { name: /Both Sides/ }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Full Details & Sources" }),
        ).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole("button", { name: "Full Details & Sources" }),
      );

      await waitFor(() => {
        expect(screen.getByText("Full Documentation")).toBeInTheDocument();
      });
    });

    it("should return to Layer 1 when Back to Summary is clicked", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      // Go to Layer 3
      await user.click(screen.getByRole("button", { name: /Both Sides/ }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Back to Summary" }),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Back to Summary" }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Learn More" }),
        ).toBeInTheDocument();
      });
    });

    it("should navigate via layer indicator dots", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      // Click "Deep Dive" dot
      await user.click(screen.getByRole("button", { name: /Deep Dive/ }));

      await waitFor(() => {
        expect(screen.getByText("Full Documentation")).toBeInTheDocument();
      });

      // Click "Quick View" dot
      await user.click(screen.getByRole("button", { name: /Quick View/ }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Learn More" }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Layer 2 - Details", () => {
    it("should render the analyzer's key provisions, yes/no outcomes, and existing-vs-proposed sections", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: "Learn More" }));

      await waitFor(() => {
        // Key provisions list
        expect(
          screen.getByText(/Reassesses commercial properties over \$3M/i),
        ).toBeInTheDocument();
        // Yes / No outcome cards
        expect(
          screen.getByText(/A yes vote means commercial properties/i),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/A no vote means current Proposition 13/i),
        ).toBeInTheDocument();
        // Existing-vs-proposed comparison
        expect(
          screen.getByText(/All real property is taxed based on its 1978/i),
        ).toBeInTheDocument();
      });
    });

    it("should show an analysis-pending placeholder when fullText is missing", async () => {
      mockQueryResult = {
        data: { proposition: mockPropositionNoExtras },
        loading: false,
        error: null,
      };

      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: "Learn More" }));

      await waitFor(() => {
        expect(
          screen.getByText(
            /Waiting for the full measure text to be extracted/i,
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Layer 4 - Deep Dive", () => {
    it("should show source link when sourceUrl is available", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: /Deep Dive/ }));

      await waitFor(() => {
        const sourceLink = screen.getByRole("link", {
          name: /Official Source/,
        });
        expect(sourceLink).toHaveAttribute(
          "href",
          "https://example.com/prop-15",
        );
      });
    });

    it("should render SegmentedFullText with section toggles and the source heading", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: /Deep Dive/ }));

      // The Layer 4 deep-dive panel renders SegmentedFullText: a sticky
      // ToC plus a collapsible block per LLM-extracted section. Both the
      // ToC entry AND the collapsible section header are buttons, so we
      // expect each heading name to match TWO elements.
      await waitFor(() => {
        expect(
          screen.getAllByRole("button", { name: /Findings/i }),
        ).toHaveLength(2);
        expect(
          screen.getAllByRole("button", { name: /Operative Provisions/i }),
        ).toHaveLength(2);
      });
    });

    it("should render the fullText body inside the segmented sections", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: /Deep Dive/ }));

      // Sections are auto-expanded for ≤3 sections, so the underlying
      // fullText slice renders without an additional click.
      await waitFor(() => {
        expect(
          screen.getByText(/amend the California Constitution/),
        ).toBeInTheDocument();
      });
    });
  });

  describe("breadcrumb", () => {
    it("should render breadcrumb with links", () => {
      render(<PropositionDetailPage />);

      const regionLink = screen.getByRole("link", { name: "Region" });
      expect(regionLink).toHaveAttribute("href", "/region");

      const propositionsLink = screen.getByRole("link", {
        name: "Propositions",
      });
      expect(propositionsLink).toHaveAttribute("href", "/region/propositions");
    });
  });
});
