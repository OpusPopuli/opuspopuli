import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import EmailHistoryPage from "@/app/settings/email-history/page";

// Mock Apollo Client
const mockRefetch = jest.fn();

let mockQueryResult = {
  data: null as { myEmailHistory: unknown } | null,
  loading: false,
  error: null as Error | null,
  refetch: mockRefetch,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockQueryResult,
}));

const mockEmails = [
  {
    id: "1",
    userId: "user-1",
    emailType: "REPRESENTATIVE_CONTACT",
    status: "SENT",
    recipientEmail: "rep@congress.gov",
    recipientName: "Rep. Jane Smith",
    subject: "Regarding Education Bill",
    bodyPreview: "Dear Representative, I am writing to express my support...",
    representativeId: "rep-1",
    representativeName: "Rep. Jane Smith",
    propositionId: null,
    propositionTitle: null,
    sentAt: "2024-12-28T10:30:00Z",
    createdAt: "2024-12-28T10:30:00Z",
    updatedAt: "2024-12-28T10:30:00Z",
    errorMessage: null,
  },
  {
    id: "2",
    userId: "user-1",
    emailType: "WELCOME",
    status: "DELIVERED",
    recipientEmail: "test@example.com",
    recipientName: "Test User",
    subject: "Welcome to Opus Populi",
    bodyPreview: "Welcome to our platform! We're excited to have you...",
    representativeId: null,
    representativeName: null,
    propositionId: null,
    propositionTitle: null,
    sentAt: "2024-12-01T09:00:00Z",
    createdAt: "2024-12-01T09:00:00Z",
    updatedAt: "2024-12-01T09:00:00Z",
    errorMessage: null,
  },
  {
    id: "3",
    userId: "user-1",
    emailType: "REPRESENTATIVE_CONTACT",
    status: "FAILED",
    recipientEmail: "rep2@congress.gov",
    recipientName: "Rep. John Doe",
    subject: "Climate Policy Concerns",
    bodyPreview: "I am writing to share my concerns about...",
    representativeId: "rep-2",
    representativeName: "Rep. John Doe",
    propositionId: "prop-1",
    propositionTitle: "Climate Action Initiative",
    sentAt: null,
    createdAt: "2024-12-15T14:00:00Z",
    updatedAt: "2024-12-15T14:00:00Z",
    errorMessage: "Recipient email rejected",
  },
];

describe("EmailHistoryPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: {
        myEmailHistory: {
          items: mockEmails,
          total: 3,
          hasMore: false,
        },
      },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
  });

  describe("loading state", () => {
    it("should show loading skeleton when data is loading", () => {
      mockQueryResult = {
        data: null,
        loading: true,
        error: null,
        refetch: mockRefetch,
      };

      const { container } = render(<EmailHistoryPage />);

      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("should show multiple skeleton items", () => {
      mockQueryResult = {
        data: null,
        loading: true,
        error: null,
        refetch: mockRefetch,
      };

      const { container } = render(<EmailHistoryPage />);

      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBe(3);
    });
  });

  describe("error state", () => {
    it("should show error message when query fails", () => {
      mockQueryResult = {
        data: null,
        loading: false,
        error: new Error("Network error"),
        refetch: mockRefetch,
      };

      render(<EmailHistoryPage />);

      expect(
        screen.getByText("Failed to load email history."),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty state when no emails exist", () => {
      mockQueryResult = {
        data: {
          myEmailHistory: {
            items: [],
            total: 0,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<EmailHistoryPage />);

      expect(screen.getByText("No emails found.")).toBeInTheDocument();
      expect(
        screen.getByText("Emails you send will appear here."),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render the page header", () => {
      render(<EmailHistoryPage />);

      expect(
        screen.getByRole("heading", { name: "Email History" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("View your sent emails and correspondence"),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<EmailHistoryPage />);

      expect(
        screen.getByRole("link", { name: "Settings" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
        "href",
        "/settings",
      );
    });

    it("should render email cards", () => {
      render(<EmailHistoryPage />);

      expect(screen.getByText("Regarding Education Bill")).toBeInTheDocument();
      expect(screen.getByText("Welcome to Opus Populi")).toBeInTheDocument();
      expect(screen.getByText("Climate Policy Concerns")).toBeInTheDocument();
    });

    it("should render status badges", () => {
      render(<EmailHistoryPage />);

      expect(screen.getByText("SENT")).toBeInTheDocument();
      expect(screen.getByText("DELIVERED")).toBeInTheDocument();
      expect(screen.getByText("FAILED")).toBeInTheDocument();
    });

    it("should render email type labels", () => {
      render(<EmailHistoryPage />);

      const repContactLabels = screen.getAllByText("Representative Contact");
      expect(repContactLabels.length).toBeGreaterThan(0);
      // Welcome appears both in filter and card, check for multiple
      const welcomeLabels = screen.getAllByText("Welcome");
      expect(welcomeLabels.length).toBeGreaterThan(0);
    });

    it("should render recipient information", () => {
      render(<EmailHistoryPage />);

      expect(screen.getByText(/To: Rep. Jane Smith/)).toBeInTheDocument();
      expect(screen.getByText(/To: Test User/)).toBeInTheDocument();
    });

    it("should render body preview", () => {
      render(<EmailHistoryPage />);

      expect(
        screen.getByText(/Dear Representative, I am writing to express/),
      ).toBeInTheDocument();
    });

    it("should render error message for failed emails", () => {
      render(<EmailHistoryPage />);

      expect(
        screen.getByText(/Error: Recipient email rejected/),
      ).toBeInTheDocument();
    });

    it("should render View Rep link for representative emails", () => {
      render(<EmailHistoryPage />);

      const viewRepLinks = screen.getAllByText("View Rep");
      expect(viewRepLinks.length).toBe(2);
      expect(viewRepLinks[0]).toHaveAttribute(
        "href",
        "/region/representatives",
      );
    });
  });

  describe("filter dropdown", () => {
    it("should render type filter dropdown", () => {
      render(<EmailHistoryPage />);

      expect(screen.getByText("Filter by type:")).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: /Filter by type/i }),
      ).toBeInTheDocument();
    });

    it("should have All Types as default selection", () => {
      render(<EmailHistoryPage />);

      const select = screen.getByRole("combobox", { name: /Filter by type/i });
      expect(select).toHaveValue("");
    });

    it("should change filter when option selected", async () => {
      const user = userEvent.setup();
      render(<EmailHistoryPage />);

      const select = screen.getByRole("combobox", { name: /Filter by type/i });
      await user.selectOptions(select, "REPRESENTATIVE_CONTACT");

      expect(select).toHaveValue("REPRESENTATIVE_CONTACT");
    });

    it("should have all filter options", () => {
      render(<EmailHistoryPage />);

      const select = screen.getByRole("combobox", { name: /Filter by type/i });
      const options = select.querySelectorAll("option");

      expect(options.length).toBe(7);
      expect(
        screen.getByRole("option", { name: "All Types" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Representative Contact" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Welcome" }),
      ).toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    it("should render pagination controls", () => {
      render(<EmailHistoryPage />);

      expect(screen.getByText("Showing 1 - 3 of 3")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Previous" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    });

    it("should disable Previous button on first page", () => {
      render(<EmailHistoryPage />);

      const previousButton = screen.getByRole("button", { name: "Previous" });
      expect(previousButton).toBeDisabled();
    });

    it("should disable Next button when no more pages", () => {
      render(<EmailHistoryPage />);

      const nextButton = screen.getByRole("button", { name: "Next" });
      expect(nextButton).toBeDisabled();
    });

    it("should enable Next button when hasMore is true", () => {
      mockQueryResult = {
        data: {
          myEmailHistory: {
            items: mockEmails,
            total: 20,
            hasMore: true,
          },
        },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<EmailHistoryPage />);

      const nextButton = screen.getByRole("button", { name: "Next" });
      expect(nextButton).not.toBeDisabled();
    });

    it("should call setPage when Next is clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          myEmailHistory: {
            items: mockEmails,
            total: 20,
            hasMore: true,
          },
        },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<EmailHistoryPage />);

      const nextButton = screen.getByRole("button", { name: "Next" });
      await user.click(nextButton);

      // After clicking, the page state should update
      // We verify by checking the pagination text shows updated range
      await waitFor(() => {
        expect(screen.getByText(/Showing 11 - /)).toBeInTheDocument();
      });
    });
  });

  describe("status badge styles", () => {
    it("should apply correct style classes for each status", () => {
      render(<EmailHistoryPage />);

      const sentBadge = screen.getByText("SENT");
      const deliveredBadge = screen.getByText("DELIVERED");
      const failedBadge = screen.getByText("FAILED");

      expect(sentBadge).toHaveClass("bg-blue-100", "text-blue-800");
      expect(deliveredBadge).toHaveClass("bg-green-100", "text-green-800");
      expect(failedBadge).toHaveClass("bg-red-100", "text-red-800");
    });
  });

  describe("email without recipient name", () => {
    it("should show email address when no recipient name", () => {
      mockQueryResult = {
        data: {
          myEmailHistory: {
            items: [
              {
                ...mockEmails[0],
                recipientName: null,
                recipientEmail: "unknown@example.com",
              },
            ],
            total: 1,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<EmailHistoryPage />);

      expect(screen.getByText(/To: unknown@example.com/)).toBeInTheDocument();
    });
  });

  describe("email without body preview", () => {
    it("should not show body preview section when empty", () => {
      mockQueryResult = {
        data: {
          myEmailHistory: {
            items: [
              {
                ...mockEmails[0],
                bodyPreview: null,
              },
            ],
            total: 1,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<EmailHistoryPage />);

      expect(screen.queryByText(/Dear Representative/)).not.toBeInTheDocument();
    });
  });

  describe("email without representative", () => {
    it("should not show View Rep link when no representativeId", () => {
      mockQueryResult = {
        data: {
          myEmailHistory: {
            items: [mockEmails[1]], // Welcome email has no representativeId
            total: 1,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<EmailHistoryPage />);

      expect(screen.queryByText("View Rep")).not.toBeInTheDocument();
    });
  });
});
