import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import RepresentativeDetailPage from "@/app/region/representatives/[id]/page";

const mockRepresentative = {
  id: "rep-1",
  externalId: "rep-1",
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
  bio: "Jane Smith has served in the Senate since 2020.",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "rep-1" }),
}));

// Mock Apollo
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

  it("should render representative name as heading", () => {
    render(<RepresentativeDetailPage />);

    expect(
      screen.getByRole("heading", { name: "Jane Smith" }),
    ).toBeInTheDocument();
  });

  it("should render party badge", () => {
    render(<RepresentativeDetailPage />);

    expect(screen.getByText("Democrat")).toBeInTheDocument();
  });

  it("should render chamber and district", () => {
    render(<RepresentativeDetailPage />);

    expect(screen.getByText("Senate")).toBeInTheDocument();
    expect(screen.getByText("District 5")).toBeInTheDocument();
  });

  it("should render bio when available", () => {
    render(<RepresentativeDetailPage />);

    expect(
      screen.getByText("Jane Smith has served in the Senate since 2020."),
    ).toBeInTheDocument();
  });

  it("should render contact information", () => {
    render(<RepresentativeDetailPage />);

    expect(screen.getByText("jane@example.gov")).toBeInTheDocument();
    expect(screen.getByText("https://example.gov/jane")).toBeInTheDocument();
    expect(screen.getByText("Capitol Office")).toBeInTheDocument();
    expect(screen.getByText("State Capitol, Room 100")).toBeInTheDocument();
    expect(screen.getByText("555-1234")).toBeInTheDocument();
  });

  it("should render contact button", () => {
    render(<RepresentativeDetailPage />);

    expect(
      screen.getByRole("button", { name: /Contact Jane/i }),
    ).toBeInTheDocument();
  });

  it("should render campaign finance placeholder", () => {
    render(<RepresentativeDetailPage />);

    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
  });

  it("should render breadcrumb navigation", () => {
    render(<RepresentativeDetailPage />);

    expect(
      screen.getByRole("link", { name: "Representatives" }),
    ).toHaveAttribute("href", "/region/representatives");
  });

  it("should show not found when representative is null", () => {
    mockQueryResult = {
      data: { representative: null },
      loading: false,
      error: undefined,
    };

    render(<RepresentativeDetailPage />);

    expect(screen.getByText("Representative not found.")).toBeInTheDocument();
  });

  it("should not render bio section when bio is null", () => {
    mockQueryResult = {
      data: {
        representative: {
          ...mockRepresentative,
          bio: null as unknown as string,
        },
      },
      loading: false,
      error: undefined,
    };

    render(<RepresentativeDetailPage />);

    expect(screen.queryByText("Biography")).not.toBeInTheDocument();
  });

  it("should not render contact section when contactInfo is null", () => {
    mockQueryResult = {
      data: {
        representative: {
          ...mockRepresentative,
          contactInfo: null as unknown as typeof mockRepresentative.contactInfo,
        },
      },
      loading: false,
      error: undefined,
    };

    render(<RepresentativeDetailPage />);

    expect(screen.queryByText("Contact Information")).not.toBeInTheDocument();
  });

  it("should render committee assignments grouped by leadership and member", () => {
    mockQueryResult = {
      data: {
        representative: {
          ...mockRepresentative,
          committees: [
            {
              name: "Budget",
              role: "Chair",
              url: "https://budget.example.gov",
            },
            {
              name: "Judiciary",
              role: "Vice Chair",
              url: "https://judiciary.example.gov",
            },
            {
              name: "Education",
              role: "Member",
              url: "https://education.example.gov",
            },
            { name: "Transportation", role: "Member" },
          ],
        },
      },
      loading: false,
      error: undefined,
    };

    render(<RepresentativeDetailPage />);

    expect(screen.getByText("Committee Assignments")).toBeInTheDocument();
    expect(screen.getByText("Leadership")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Chair")).toBeInTheDocument();
    expect(screen.getByText("Vice Chair")).toBeInTheDocument();
    expect(screen.getByText("Education")).toBeInTheDocument();
    expect(screen.getByText("Transportation")).toBeInTheDocument();
  });

  it("should render committee links when URL is provided", () => {
    mockQueryResult = {
      data: {
        representative: {
          ...mockRepresentative,
          committees: [
            {
              name: "Budget",
              role: "Member",
              url: "https://budget.example.gov",
            },
          ],
        },
      },
      loading: false,
      error: undefined,
    };

    render(<RepresentativeDetailPage />);

    const link = screen.getByRole("link", { name: "Budget" });
    expect(link).toHaveAttribute("href", "https://budget.example.gov");
  });

  it("should not render committee section when committees is empty", () => {
    mockQueryResult = {
      data: {
        representative: {
          ...mockRepresentative,
          committees: [],
        },
      },
      loading: false,
      error: undefined,
    };

    render(<RepresentativeDetailPage />);

    expect(screen.queryByText("Committee Assignments")).not.toBeInTheDocument();
  });

  it("should not render committee section when committees is undefined", () => {
    render(<RepresentativeDetailPage />);

    // mockRepresentative has no committees field
    expect(screen.queryByText("Committee Assignments")).not.toBeInTheDocument();
  });

  it("should render source attribution on contact section", () => {
    render(<RepresentativeDetailPage />);

    expect(screen.getByText("California State Senate")).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
  });
});
