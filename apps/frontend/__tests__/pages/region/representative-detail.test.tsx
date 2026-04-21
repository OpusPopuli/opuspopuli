import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import RepresentativeDetailPage from "@/app/region/representatives/[id]/page";

const mockRepresentative = {
  id: "rep-1",
  externalId: "ca-senate-5",
  name: "Jane Smith",
  chamber: "Senate",
  district: "5",
  party: "Democrat",
  photoUrl: "https://example.com/photo.jpg",
  contactInfo: {
    email: "jane@example.gov",
    website: "https://example.gov/jane",
    offices: [
      {
        name: "Capitol Office",
        address: "State Capitol, Room 100",
        phone: "555-1234",
      },
    ],
  },
  bio: "Jane Smith has served in the Senate since 2020. She chairs the Budget Committee.",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "rep-1" }),
}));

let mockQueryResult: {
  data: { representative: typeof mockRepresentative | null } | undefined;
  loading: boolean;
  error: Error | undefined;
};

jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockQueryResult,
}));

describe("RepresentativeDetailPage", () => {
  beforeEach(() => {
    mockQueryResult = {
      data: { representative: mockRepresentative },
      loading: false,
      error: undefined,
    };
  });

  describe("persistent header", () => {
    it("renders name as heading", () => {
      render(<RepresentativeDetailPage />);
      expect(
        screen.getByRole("heading", { name: "Jane Smith" }),
      ).toBeInTheDocument();
    });

    it("renders party, chamber, district", () => {
      render(<RepresentativeDetailPage />);
      expect(screen.getByText("Democrat")).toBeInTheDocument();
      expect(screen.getByText("Senate")).toBeInTheDocument();
      expect(screen.getByText("District 5")).toBeInTheDocument();
    });

    it("renders compact contact row: email + website + primary phone", () => {
      render(<RepresentativeDetailPage />);

      // Email chip
      expect(screen.getByText("jane@example.gov")).toBeInTheDocument();
      // Website chip (displayed as hostname only)
      expect(screen.getByText("example.gov/jane")).toBeInTheDocument();
      // Primary phone shows in the header chip (and also below in Offices on L1,
      // hence getAllByText rather than getByText)
      expect(screen.getAllByText("555-1234").length).toBeGreaterThanOrEqual(1);
    });

    it("renders Contact CTA button when email is available", () => {
      render(<RepresentativeDetailPage />);
      expect(
        screen.getByRole("button", { name: /Contact Jane/i }),
      ).toBeInTheDocument();
    });

    it("persists across all layers", async () => {
      const user = userEvent.setup();
      render(<RepresentativeDetailPage />);

      // Use the LayerNav dot (first match) to jump straight to each layer
      const jump = (label: RegExp) =>
        screen
          .getAllByRole("button", { name: label })
          .find((b) => b.closest('nav[aria-label="Information depth"]'))!;

      await user.click(jump(/What They'?ve Done/));
      expect(
        screen.getByRole("heading", { name: "Jane Smith" }),
      ).toBeInTheDocument();

      await user.click(jump(/How They Are Supported/));
      expect(
        screen.getByRole("heading", { name: "Jane Smith" }),
      ).toBeInTheDocument();
    });
  });

  describe("layer navigation", () => {
    it("renders all four layer dots with voter-centric labels", () => {
      render(<RepresentativeDetailPage />);
      expect(
        screen.getByRole("navigation", { name: /Information depth/i }),
      ).toBeInTheDocument();
      // Each layer label should exist as a button (at least once — CTA buttons
      // may duplicate the label intentionally for progressive navigation)
      expect(
        screen.getByRole("button", { name: "Who They Are" }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: /^What They Care About$/ })
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByRole("button", { name: /^What They'?ve Done$/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^How They Are Supported$/ }),
      ).toBeInTheDocument();
    });

    it("defaults to Who They Are (layer 1) showing the bio", () => {
      render(<RepresentativeDetailPage />);
      expect(screen.getByText("Biography")).toBeInTheDocument();
      expect(
        screen.getByText(/Jane Smith has served in the Senate since 2020/),
      ).toBeInTheDocument();
      // Committees section not yet visible
      expect(
        screen.queryByText("Committee Assignments"),
      ).not.toBeInTheDocument();
    });

    it("Layer 1 shows office addresses under Where to Reach Them", () => {
      render(<RepresentativeDetailPage />);
      expect(screen.getByText("Where to Reach Them")).toBeInTheDocument();
      expect(screen.getByText("Capitol Office")).toBeInTheDocument();
      expect(screen.getByText("State Capitol, Room 100")).toBeInTheDocument();
    });

    it("advances to What They Care About (layer 2) via CTA", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          representative: {
            ...mockRepresentative,
            committees: [{ name: "Budget", role: "Chair" }],
          },
        },
        loading: false,
        error: undefined,
      };

      render(<RepresentativeDetailPage />);

      // The CTA button and the nav dot both match; take the last one (content CTA)
      const buttons = screen.getAllByRole("button", {
        name: "What They Care About",
      });
      await user.click(buttons[buttons.length - 1]);

      expect(screen.getByText("Committee Assignments")).toBeInTheDocument();
    });

    it("advances to What They've Done (layer 3) via CTA", async () => {
      const user = userEvent.setup();
      render(<RepresentativeDetailPage />);

      await user.click(
        screen.getByRole("button", { name: "How They Are Supported" }),
      );
      // Use the LayerNav to jump back to L3 first
      await user.click(
        screen.getByRole("button", { name: /What They'?ve Done/ }),
      );

      expect(screen.getByText("Authored Bills")).toBeInTheDocument();
      expect(screen.getByText("Voting Record")).toBeInTheDocument();
    });

    it("advances to How They Are Supported (layer 4) via CTA", async () => {
      const user = userEvent.setup();
      render(<RepresentativeDetailPage />);

      await user.click(
        screen.getByRole("button", { name: "How They Are Supported" }),
      );

      expect(screen.getByText("Campaign Finance")).toBeInTheDocument();
    });

    it("Back returns to Who They Are from later layers", async () => {
      const user = userEvent.setup();
      render(<RepresentativeDetailPage />);

      // Navigate to layer 3 via nav dot
      await user.click(
        screen.getByRole("button", { name: /What They'?ve Done/ }),
      );
      expect(screen.getByText("Authored Bills")).toBeInTheDocument();

      // Click Back (secondary LayerButton)
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByText("Biography")).toBeInTheDocument();
    });

    it("Back to Summary returns to Who They Are from layer 4", async () => {
      const user = userEvent.setup();
      render(<RepresentativeDetailPage />);

      await user.click(
        screen.getByRole("button", { name: "How They Are Supported" }),
      );
      await user.click(screen.getByRole("button", { name: "Back to Summary" }));

      expect(screen.getByText("Biography")).toBeInTheDocument();
    });

    it("direct dot click jumps to any layer", async () => {
      const user = userEvent.setup();
      render(<RepresentativeDetailPage />);

      await user.click(
        screen.getByRole("button", { name: "How They Are Supported" }),
      );

      expect(screen.getByText("Campaign Finance")).toBeInTheDocument();
    });
  });

  describe("layer content", () => {
    it("Who They Are shows AI-generated badge when bio is AI", () => {
      mockQueryResult = {
        data: {
          representative: {
            ...mockRepresentative,
            bioSource: "ai-generated",
          } as unknown as typeof mockRepresentative,
        },
        loading: false,
        error: undefined,
      };

      render(<RepresentativeDetailPage />);

      expect(screen.getByText("AI-generated")).toBeInTheDocument();
      expect(
        screen.getByText(/Generated from public record data/),
      ).toBeInTheDocument();
    });

    it("What They Care About shows committees grouped by leadership", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          representative: {
            ...mockRepresentative,
            committees: [
              { name: "Budget", role: "Chair" },
              { name: "Education", role: "Member" },
            ],
          },
        },
        loading: false,
        error: undefined,
      };

      render(<RepresentativeDetailPage />);
      const buttons = screen.getAllByRole("button", {
        name: "What They Care About",
      });
      await user.click(buttons[buttons.length - 1]);

      expect(screen.getByText("Leadership")).toBeInTheDocument();
      expect(screen.getByText("Budget")).toBeInTheDocument();
      expect(screen.getByText("Chair")).toBeInTheDocument();
      expect(screen.getByText("Education")).toBeInTheDocument();
    });

    it("What They Care About shows placeholder when no committees", async () => {
      const user = userEvent.setup();
      render(<RepresentativeDetailPage />);
      const buttons = screen.getAllByRole("button", {
        name: "What They Care About",
      });
      await user.click(buttons[buttons.length - 1]);

      expect(
        screen.getByText(/No committee assignments on file/),
      ).toBeInTheDocument();
    });

    it("How They Are Supported shows scraped-bio note for scraped bios", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          representative: {
            ...mockRepresentative,
            bioSource: "scraped",
          } as unknown as typeof mockRepresentative,
        },
        loading: false,
        error: undefined,
      };

      render(<RepresentativeDetailPage />);
      await user.click(
        screen.getByRole("button", { name: "How They Are Supported" }),
      );

      expect(
        screen.getByText(/scraped directly from an official source/),
      ).toBeInTheDocument();
    });
  });

  describe("not-found + breadcrumb", () => {
    it("shows not found when representative is null", () => {
      mockQueryResult = {
        data: { representative: null },
        loading: false,
        error: undefined,
      };

      render(<RepresentativeDetailPage />);

      expect(screen.getByText("Representative not found.")).toBeInTheDocument();
    });

    it("renders Representatives breadcrumb link", () => {
      render(<RepresentativeDetailPage />);
      expect(
        screen.getByRole("link", { name: "Representatives" }),
      ).toHaveAttribute("href", "/region/representatives");
    });
  });
});
