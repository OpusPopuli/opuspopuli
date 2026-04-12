import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import RepresentativesPage from "@/app/region/representatives/page";

// Mock data - district values without "District" prefix since component adds it
const mockRepresentatives = {
  items: [
    {
      id: "1",
      externalId: "rep-1",
      name: "Jane Smith",
      chamber: "Senate",
      district: "5",
      party: "Democrat",
      photoUrl: "https://example.com/photo1.jpg",
      contactInfo: {
        email: "jane.smith@example.gov",
        phone: "555-1234",
        office: "State Capitol, Room 100",
        website: "https://example.com/janesmith",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "rep-2",
      name: "John Doe",
      chamber: "Assembly",
      district: "12",
      party: "Republican",
      photoUrl: null,
      contactInfo: {
        email: "john.doe@example.gov",
        phone: "555-5678",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "3",
      externalId: "rep-3",
      name: "Alex Johnson",
      chamber: "Senate",
      district: "8",
      party: "Independent",
      photoUrl: "https://example.com/photo3.jpg",
      contactInfo: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 3,
  hasMore: false,
};

let mockQueryResult = {
  data: { representatives: mockRepresentatives },
  loading: false,
  error: null as Error | null,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: jest.fn(() => mockQueryResult),
}));

// Mock next/link
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

// Mock next/image
jest.mock("next/image", () => {
  return function MockImage({
    src,
    alt,
    ...props
  }: {
    src: string;
    alt: string;
    [key: string]: unknown;
  }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...props} />;
  };
});

describe("RepresentativesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { representatives: mockRepresentatives },
      loading: false,
      error: null,
    };
  });

  describe("loading state", () => {
    it("should show loading skeleton", () => {
      mockQueryResult = {
        data: null as unknown as typeof mockQueryResult.data,
        loading: true,
        error: null,
      };

      render(<RepresentativesPage />);

      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("should show error message when query fails", () => {
      mockQueryResult = {
        data: null as unknown as typeof mockQueryResult.data,
        loading: false,
        error: new Error("Failed to fetch"),
      };

      render(<RepresentativesPage />);

      expect(
        screen.getByText(/Failed to load representatives/i),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no representatives", () => {
      mockQueryResult = {
        data: {
          representatives: {
            items: [],
            total: 0,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
      };

      render(<RepresentativesPage />);

      expect(screen.getByText("No representatives found.")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render page header", () => {
      render(<RepresentativesPage />);

      expect(
        screen.getByRole("heading", { name: "Representatives" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Elected officials and legislators"),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<RepresentativesPage />);

      const regionLink = screen.getByRole("link", { name: /Region/i });
      expect(regionLink).toHaveAttribute("href", "/region");
    });

    it("should render representative cards", () => {
      render(<RepresentativesPage />);

      expect(screen.getByText("Jane Smith")).toBeInTheDocument();
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("Alex Johnson")).toBeInTheDocument();
    });

    it("should render chamber information", () => {
      render(<RepresentativesPage />);

      const senateLabels = screen.getAllByText("Senate");
      const assemblyLabels = screen.getAllByText("Assembly");

      expect(senateLabels.length).toBeGreaterThan(0);
      expect(assemblyLabels.length).toBeGreaterThan(0);
    });

    it("should render district information", () => {
      render(<RepresentativesPage />);

      expect(screen.getByText("District 5")).toBeInTheDocument();
      expect(screen.getByText("District 12")).toBeInTheDocument();
      expect(screen.getByText("District 8")).toBeInTheDocument();
    });

    it("should render party badges", () => {
      render(<RepresentativesPage />);

      expect(screen.getByText("Democrat")).toBeInTheDocument();
      expect(screen.getByText("Republican")).toBeInTheDocument();
      expect(screen.getByText("Independent")).toBeInTheDocument();
    });

    it("should link representative cards to detail page", () => {
      render(<RepresentativesPage />);

      const janeLink = screen.getByRole("link", { name: /Jane Smith/i });
      expect(janeLink).toHaveAttribute("href", "/region/representatives/1");
    });

    it("should render photos when available", () => {
      render(<RepresentativesPage />);

      const photos = screen.getAllByRole("img");
      expect(photos.length).toBeGreaterThan(0);
    });

    it("should render placeholder for missing photos", () => {
      render(<RepresentativesPage />);

      // John Doe has no photo, should show placeholder
      const svgElements = document.querySelectorAll("svg");
      expect(svgElements.length).toBeGreaterThan(0);
    });
  });

  describe("party badge colors", () => {
    it("should apply correct colors for different parties", () => {
      render(<RepresentativesPage />);

      const democratBadge = screen.getByText("Democrat");
      const republicanBadge = screen.getByText("Republican");
      const independentBadge = screen.getByText("Independent");

      expect(democratBadge).toHaveClass("bg-blue-100", "text-blue-800");
      expect(republicanBadge).toHaveClass("bg-red-100", "text-red-800");
      expect(independentBadge).toHaveClass("bg-purple-100", "text-purple-800");
    });
  });

  describe("chamber filter", () => {
    it("should render chamber filter dropdown", () => {
      render(<RepresentativesPage />);

      expect(screen.getByText("Filter:")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("should have All Chambers option", () => {
      render(<RepresentativesPage />);

      const select = screen.getByRole("combobox");
      expect(select).toHaveDisplayValue("All Chambers");
    });

    it("should filter by chamber when selected", async () => {
      const user = userEvent.setup();
      render(<RepresentativesPage />);

      const select = screen.getByRole("combobox");
      await user.selectOptions(select, "Senate");

      await waitFor(() => {
        expect(select).toHaveDisplayValue("Senate");
      });
    });
  });

  describe("pagination", () => {
    it("should show pagination info", () => {
      render(<RepresentativesPage />);

      expect(screen.getByText(/Showing 1 - 3 of 3/)).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      render(<RepresentativesPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });

    it("should disable next button when no more items", () => {
      render(<RepresentativesPage />);

      expect(screen.getByText("Next")).toBeDisabled();
    });

    it("should enable next button when hasMore is true", () => {
      mockQueryResult = {
        data: {
          representatives: {
            ...mockRepresentatives,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<RepresentativesPage />);

      expect(screen.getByText("Next")).not.toBeDisabled();
    });

    it("should navigate pages when buttons are clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          representatives: {
            ...mockRepresentatives,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<RepresentativesPage />);

      await user.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Previous")).not.toBeDisabled();
      });
    });

    it("should reset pagination when filter changes", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          representatives: {
            ...mockRepresentatives,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<RepresentativesPage />);

      // Go to page 2
      await user.click(screen.getByText("Next"));

      // Change filter
      const select = screen.getByRole("combobox");
      await user.selectOptions(select, "Senate");

      // Should reset to page 1
      await waitFor(() => {
        expect(screen.getByText("Previous")).toBeDisabled();
      });
    });
  });
});
