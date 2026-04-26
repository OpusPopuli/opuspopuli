import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import LegislativeCommitteesPage from "@/app/region/legislative-committees/page";

const mockCommittees = {
  items: [
    {
      id: "c1",
      externalId: "assembly:budget",
      name: "Budget",
      chamber: "Assembly",
      url: null,
      description: null,
      memberCount: 12,
    },
    {
      id: "c2",
      externalId: "senate:health",
      name: "Health",
      chamber: "Senate",
      url: null,
      description: "Oversees public health policy.",
      memberCount: 8,
    },
  ],
  total: 2,
  hasMore: false,
};

let mockQueryResult: {
  data: { legislativeCommittees: typeof mockCommittees } | null;
  loading: boolean;
  error: Error | null;
} = {
  data: { legislativeCommittees: mockCommittees },
  loading: false,
  error: null,
};

const useQueryMock = jest.fn(() => mockQueryResult);

jest.mock("@apollo/client/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...(args as [])),
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

describe("LegislativeCommitteesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { legislativeCommittees: mockCommittees },
      loading: false,
      error: null,
    };
  });

  it("renders loading state", () => {
    mockQueryResult = { data: null, loading: true, error: null };
    render(<LegislativeCommitteesPage />);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
  });

  it("renders error state", () => {
    mockQueryResult = {
      data: null,
      loading: false,
      error: new Error("boom"),
    };
    render(<LegislativeCommitteesPage />);
    expect(
      screen.getByText(/failed to load legislative committees/i),
    ).toBeInTheDocument();
  });

  it("renders empty state when there are no committees", () => {
    mockQueryResult = {
      data: {
        legislativeCommittees: { items: [], total: 0, hasMore: false },
      },
      loading: false,
      error: null,
    };
    render(<LegislativeCommitteesPage />);
    expect(screen.getByText(/no legislative committees/i)).toBeInTheDocument();
  });

  it("renders each committee with member count and chamber", () => {
    render(<LegislativeCommitteesPage />);
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Health")).toBeInTheDocument();
    expect(screen.getByText(/12 members/)).toBeInTheDocument();
    expect(screen.getByText(/8 members/)).toBeInTheDocument();
    // Each card links into the detail page.
    expect(
      screen.getByRole("link", { name: /Budget/i }).getAttribute("href"),
    ).toBe("/region/legislative-committees/c1");
    expect(
      screen.getByRole("link", { name: /Health/i }).getAttribute("href"),
    ).toBe("/region/legislative-committees/c2");
  });

  it("re-issues the query with the chamber filter when toggled", async () => {
    const user = userEvent.setup();
    render(<LegislativeCommitteesPage />);

    // Most recent call before clicking — chamber should be undefined.
    const initial = useQueryMock.mock.calls.at(-1);
    expect(
      (initial as unknown as Array<{ variables?: { chamber?: string } }>)?.[1]
        ?.variables?.chamber,
    ).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Senate" }));

    const afterClick = useQueryMock.mock.calls.at(-1);
    expect(
      (
        afterClick as unknown as Array<{ variables?: { chamber?: string } }>
      )?.[1]?.variables?.chamber,
    ).toBe("Senate");
  });
});
