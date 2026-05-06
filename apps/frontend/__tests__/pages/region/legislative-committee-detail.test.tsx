import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import LegislativeCommitteeDetailPage from "@/app/region/legislative-committees/[id]/page";

const mockCommittee = {
  id: "c1",
  externalId: "assembly:budget",
  name: "Budget",
  chamber: "Assembly",
  url: "https://example.com/budget",
  description: "Reviews and approves the state budget.",
  memberCount: 4,
  members: [
    {
      representativeId: "r-chair",
      name: "Chair Person",
      role: "Chair",
      party: "Democrat",
      photoUrl: null,
    },
    {
      representativeId: "r-vc",
      name: "Vice Chair Person",
      role: "Vice Chair",
      party: "Democrat",
      photoUrl: null,
    },
    {
      representativeId: "r-1",
      name: "Member One",
      role: "Member",
      party: "Republican",
      photoUrl: null,
    },
    {
      representativeId: "r-2",
      name: "Member Two",
      role: "Member",
      party: "Democrat",
      photoUrl: null,
    },
  ],
  hearings: [
    {
      id: "m1",
      title: "Budget Subcommittee — Hearing",
      scheduledAt: "2026-04-12T10:00:00Z",
      agendaUrl: "https://example.com/m1",
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

let mockQueryResult: {
  data: { legislativeCommittee: typeof mockCommittee | null } | null;
  loading: boolean;
  error: Error | null;
} = {
  data: { legislativeCommittee: mockCommittee },
  loading: false,
  error: null,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: jest.fn(() => mockQueryResult),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({ id: "c1" })),
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

jest.mock("next/image", () => {
  return function MockImage(props: Record<string, unknown>) {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, string>)} />;
  };
});

describe("LegislativeCommitteeDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { legislativeCommittee: mockCommittee },
      loading: false,
      error: null,
    };
  });

  it("renders loading state", () => {
    mockQueryResult = { data: null, loading: true, error: null };
    render(<LegislativeCommitteeDetailPage />);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
  });

  it("renders error state", () => {
    mockQueryResult = {
      data: null,
      loading: false,
      error: new Error("nope"),
    };
    render(<LegislativeCommitteeDetailPage />);
    expect(
      screen.getByText(/failed to load legislative committee/i),
    ).toBeInTheDocument();
  });

  it("renders not-found state when the query resolves to null", () => {
    mockQueryResult = {
      data: { legislativeCommittee: null },
      loading: false,
      error: null,
    };
    render(<LegislativeCommitteeDetailPage />);
    expect(screen.getByText(/Committee not found/i)).toBeInTheDocument();
  });

  it("shows the snapshot layer with chair name", () => {
    render(<LegislativeCommitteeDetailPage />);
    // Heading shows committee name
    expect(
      screen.getByRole("heading", { level: 1, name: "Budget" }),
    ).toBeInTheDocument();
    // Chair card from members list
    expect(screen.getByText("Chair Person")).toBeInTheDocument();
    // Description renders instead of ComingSoon
    expect(
      screen.getByText(/Reviews and approves the state budget/),
    ).toBeInTheDocument();
  });

  it("groups members by role on the Members layer", async () => {
    const user = userEvent.setup();
    render(<LegislativeCommitteeDetailPage />);

    await user.click(screen.getByRole("button", { name: "See members" }));

    expect(
      screen.getByRole("heading", { level: 3, name: "Chair" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Vice Chair" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Members" }),
    ).toBeInTheDocument();

    // Each member links to its representative detail page.
    const chairLink = screen
      .getAllByRole("link")
      .find(
        (l) => l.getAttribute("href") === "/region/representatives/r-chair",
      );
    expect(chairLink).toBeDefined();
  });

  it("shows the live activity feed + scheduled meetings on the Hearings layer", async () => {
    const user = userEvent.setup();
    render(<LegislativeCommitteeDetailPage />);

    await user.click(screen.getByRole("button", { name: "See members" }));
    await user.click(screen.getByRole("button", { name: "See hearings" }));

    // Section headings — the new feed leads, scheduled meetings follow
    // for forward-looking context. (Issue #665.)
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Upcoming scheduled meetings")).toBeInTheDocument();
    expect(
      screen.getByText(/Budget Subcommittee — Hearing/),
    ).toBeInTheDocument();
  });

  it("shows just the activity feed when no scheduled meetings match", async () => {
    mockQueryResult = {
      data: { legislativeCommittee: { ...mockCommittee, hearings: [] } },
      loading: false,
      error: null,
    };
    const user = userEvent.setup();
    render(<LegislativeCommitteeDetailPage />);

    await user.click(screen.getByRole("button", { name: "See members" }));
    await user.click(screen.getByRole("button", { name: "See hearings" }));

    // The new "Recent activity" section is always present; the
    // "Upcoming scheduled meetings" section only renders when the
    // legacy `committee.hearings` array is non-empty.
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(
      screen.queryByText("Upcoming scheduled meetings"),
    ).not.toBeInTheDocument();
  });
});
