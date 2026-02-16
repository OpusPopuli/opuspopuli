import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PropositionDetailPage from "@/app/region/propositions/[id]/page";

// Mock data
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

    it("should render summary", () => {
      render(<PropositionDetailPage />);

      expect(
        screen.getByText(
          "Changes how commercial properties are taxed by requiring reassessment at market value.",
        ),
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

    it("should show impact analysis placeholder", () => {
      render(<PropositionDetailPage />);

      expect(
        screen.getByText("Impact analysis coming soon"),
      ).toBeInTheDocument();
    });
  });

  describe("Layer Navigation", () => {
    it("should navigate to Layer 2 when Learn More is clicked", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: "Learn More" }));

      await waitFor(() => {
        expect(screen.getByText("What This Does")).toBeInTheDocument();
      });
    });

    it("should navigate to Layer 3 when See Both Sides is clicked", async () => {
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
    it("should show fullText in What This Does section", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: "Learn More" }));

      await waitFor(() => {
        expect(
          screen.getByText(/amend the California Constitution/),
        ).toBeInTheDocument();
      });
    });

    it("should show coming soon placeholders for key facts and funding", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: "Learn More" }));

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Key Facts" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Yes Campaign")).toBeInTheDocument();
        expect(screen.getByText("No Campaign")).toBeInTheDocument();
      });
    });

    it("should show placeholder when fullText is not available", async () => {
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
          screen.getByText("AI-powered explanation coming soon"),
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

    it("should show full text toggle when fullText is available", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: /Deep Dive/ }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", {
            name: /Read Full Proposition Text/,
          }),
        ).toBeInTheDocument();
      });
    });

    it("should expand full text when toggle is clicked", async () => {
      const user = userEvent.setup();
      render(<PropositionDetailPage />);

      await user.click(screen.getByRole("button", { name: /Deep Dive/ }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", {
            name: /Read Full Proposition Text/,
          }),
        ).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole("button", {
          name: /Read Full Proposition Text/,
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(/amend the California Constitution/),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", {
            name: /Hide Full Proposition Text/,
          }),
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
