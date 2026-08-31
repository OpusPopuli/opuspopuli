import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import ActivityPage from "@/app/settings/activity/page";
import { I18nProvider } from "@/lib/i18n/context";

const renderWithI18n = (ui: React.ReactElement) => {
  return render(<I18nProvider>{ui}</I18nProvider>);
};

// Mock toast context
const mockShowToast = jest.fn();
jest.mock("@/lib/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

// Mock Apollo Client
const mockRefetchActivity = jest.fn();
const mockRefetchSessions = jest.fn();
const mockRevokeSession = jest.fn();
const mockRevokeAllSessions = jest.fn();

const mockActivityLog = {
  items: [
    {
      id: "log-1",
      action: "LOGIN",
      entityType: null,
      entityId: null,
      operationName: "login",
      operationType: "mutation",
      success: true,
      errorMessage: null,
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      deviceType: "desktop",
      browser: "Chrome",
      timestamp: "2024-01-20T10:00:00Z",
    },
    {
      id: "log-2",
      action: "UPDATE",
      entityType: "Profile",
      entityId: "profile-123",
      operationName: "updateProfile",
      operationType: "mutation",
      success: true,
      errorMessage: null,
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      deviceType: "desktop",
      browser: "Chrome",
      timestamp: "2024-01-20T09:00:00Z",
    },
    {
      id: "log-3",
      action: "LOGIN_FAILED",
      entityType: null,
      entityId: null,
      operationName: "login",
      operationType: "mutation",
      success: false,
      errorMessage: "Invalid credentials",
      ipAddress: "192.168.1.2",
      userAgent: "Mozilla/5.0",
      deviceType: "mobile",
      browser: "Safari",
      timestamp: "2024-01-19T15:00:00Z",
    },
  ],
  total: 3,
  hasMore: false,
};

const mockActivitySummary: {
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  activeSessions: number;
  lastLoginAt?: string;
  lastActivityAt?: string;
} = {
  totalActions: 150,
  successfulActions: 145,
  failedActions: 5,
  activeSessions: 2,
  lastLoginAt: "2024-01-20T10:00:00Z",
  lastActivityAt: "2024-01-20T10:30:00Z",
};

const mockSessions = {
  items: [
    {
      id: "session-1",
      deviceType: "desktop",
      deviceName: "MacBook Pro",
      browser: "Chrome",
      operatingSystem: "macOS",
      city: "San Francisco",
      region: "California",
      country: "USA",
      isActive: true,
      isCurrent: true,
      lastActivityAt: "2024-01-20T10:30:00Z",
      createdAt: "2024-01-15T08:00:00Z",
      expiresAt: "2024-02-15T08:00:00Z",
      revokedAt: null,
    },
    {
      id: "session-2",
      deviceType: "mobile",
      deviceName: "iPhone 15",
      browser: "Safari",
      operatingSystem: "iOS",
      city: "New York",
      region: "New York",
      country: "USA",
      isActive: true,
      isCurrent: false,
      lastActivityAt: "2024-01-19T18:00:00Z",
      createdAt: "2024-01-10T12:00:00Z",
      expiresAt: "2024-02-10T12:00:00Z",
      revokedAt: null,
    },
  ],
  total: 2,
};

let mockActivityLogQuery = {
  data: { myActivityLog: mockActivityLog },
  loading: false,
  error: null as Error | null,
  refetch: mockRefetchActivity,
};

let mockActivitySummaryQuery = {
  data: { myActivitySummary: mockActivitySummary },
  loading: false,
  error: null as Error | null,
};

let mockSessionsQuery = {
  data: { mySessions: mockSessions },
  loading: false,
  error: null as Error | null,
  refetch: mockRefetchSessions,
};

let mockRevokeMutationResult = { loading: false };
let mockRevokeAllMutationResult = { loading: false };

jest.mock("@apollo/client/react", () => ({
  useQuery: jest.fn((query) => {
    const queryName = query?.definitions?.[0]?.name?.value;
    if (queryName === "GetMyActivityLog") {
      return mockActivityLogQuery;
    }
    if (queryName === "GetMyActivitySummary") {
      return mockActivitySummaryQuery;
    }
    if (queryName === "GetMySessions") {
      return mockSessionsQuery;
    }
    return { data: null, loading: false, error: null };
  }),
  useMutation: jest.fn((mutation) => {
    const mutationName = mutation?.definitions?.[0]?.name?.value;
    if (mutationName === "RevokeSession") {
      return [mockRevokeSession, mockRevokeMutationResult];
    }
    if (mutationName === "RevokeAllOtherSessions") {
      return [mockRevokeAllSessions, mockRevokeAllMutationResult];
    }
    return [jest.fn(), { loading: false }];
  }),
}));

describe("ActivityPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.confirm = jest.fn(() => true);

    mockActivityLogQuery = {
      data: { myActivityLog: mockActivityLog },
      loading: false,
      error: null,
      refetch: mockRefetchActivity,
    };

    mockActivitySummaryQuery = {
      data: { myActivitySummary: mockActivitySummary },
      loading: false,
      error: null,
    };

    mockSessionsQuery = {
      data: { mySessions: mockSessions },
      loading: false,
      error: null,
      refetch: mockRefetchSessions,
    };

    mockRevokeMutationResult = { loading: false };
    mockRevokeAllMutationResult = { loading: false };
  });

  describe("loading state", () => {
    it("should show loading state for summary", () => {
      mockActivitySummaryQuery = {
        ...mockActivitySummaryQuery,
        data: null as unknown as typeof mockActivitySummaryQuery.data,
        loading: true,
      };

      renderWithI18n(<ActivityPage />);

      expect(screen.getAllByText("...").length).toBeGreaterThan(0);
    });

    it("should show loading state for activity log", () => {
      mockActivityLogQuery = {
        ...mockActivityLogQuery,
        data: null as unknown as typeof mockActivityLogQuery.data,
        loading: true,
      };

      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render the page header", () => {
      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Activity Log")).toBeInTheDocument();
      expect(
        screen.getByText(
          "View your account activity and manage active sessions",
        ),
      ).toBeInTheDocument();
    });

    it("should render summary cards", () => {
      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Total Actions")).toBeInTheDocument();
      expect(screen.getByText("150")).toBeInTheDocument();
      expect(screen.getByText("Success Rate")).toBeInTheDocument();
      expect(screen.getByText("97%")).toBeInTheDocument();
      // "Active Sessions" appears in both summary card and tab
      expect(screen.getAllByText("Active Sessions").length).toBeGreaterThan(0);
      // "2" can appear multiple times (session count, dates, etc.)
      expect(screen.getAllByText("2").length).toBeGreaterThan(0);
      expect(screen.getByText("Last Login")).toBeInTheDocument();
    });

    it("should render activity tabs", () => {
      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Recent Activity")).toBeInTheDocument();
      // "Active Sessions" appears twice: in summary card and as tab
      expect(
        screen.getAllByText("Active Sessions").length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("should render activity log entries", () => {
      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Logged in")).toBeInTheDocument();
      expect(screen.getByText(/Updated/)).toBeInTheDocument();
      expect(screen.getByText("profile")).toBeInTheDocument();
      expect(screen.getByText("Login failed")).toBeInTheDocument();
    });

    it("should show error message for failed actions", () => {
      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });

    it("should show browser and IP address", () => {
      renderWithI18n(<ActivityPage />);

      expect(screen.getAllByText("Chrome").length).toBeGreaterThan(0);
      expect(screen.getAllByText("192.168.1.1").length).toBeGreaterThan(0);
    });
  });

  describe("tab navigation", () => {
    // Helper to click the sessions tab (not the summary card)
    const clickSessionsTab = async (
      user: ReturnType<typeof userEvent.setup>,
    ) => {
      const tabs = screen.getAllByText("Active Sessions");
      // The second "Active Sessions" text is the tab button
      await user.click(tabs[1]);
    };

    it("should switch to sessions tab when clicked", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(screen.getByText("MacBook Pro")).toBeInTheDocument();
      });
      expect(screen.getByText("iPhone 15")).toBeInTheDocument();
    });

    it("should show current badge for current session", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(screen.getByText("Current")).toBeInTheDocument();
      });
    });

    it("should show session device info", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(screen.getByText(/Chrome.*macOS/)).toBeInTheDocument();
      });
      expect(screen.getByText(/Safari.*iOS/)).toBeInTheDocument();
    });

    it("should show session location", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(
          screen.getByText("San Francisco, California, USA"),
        ).toBeInTheDocument();
      });
      expect(screen.getByText("New York, New York, USA")).toBeInTheDocument();
    });
  });

  describe("session revocation", () => {
    // Helper to click the sessions tab (not the summary card)
    const clickSessionsTab = async (
      user: ReturnType<typeof userEvent.setup>,
    ) => {
      const tabs = screen.getAllByText("Active Sessions");
      await user.click(tabs[1]);
    };

    it("should show revoke button for non-current sessions", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(screen.getByText("Revoke")).toBeInTheDocument();
      });
    });

    it("should show confirmation when revoke is clicked", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(screen.getByText("Revoke")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Revoke"));

      expect(screen.getByText("Confirm")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("should cancel revoke when cancel is clicked", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(screen.getByText("Revoke")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Revoke"));
      await user.click(screen.getByText("Cancel"));

      expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
    });
  });

  describe("session naming", () => {
    const clickSessionsTab = async (
      user: ReturnType<typeof userEvent.setup>,
    ) => {
      const tabs = screen.getAllByText("Active Sessions");
      await user.click(tabs[1]);
    };

    it("falls back to the device type when a session has no name", async () => {
      const user = userEvent.setup();
      // Sessions written before the backend stored a device name have
      // none — every one of them used to read "Unknown Device".
      mockSessionsQuery = {
        ...mockSessionsQuery,
        data: {
          mySessions: {
            items: [
              {
                ...mockSessions.items[1],
                deviceName: undefined,
                isCurrent: true,
              },
            ],
            total: 1,
          },
        },
      };

      renderWithI18n(<ActivityPage />);
      await clickSessionsTab(user);

      await waitFor(() => {
        expect(screen.getByText("Mobile")).toBeInTheDocument();
      });
      expect(screen.queryByText("Unknown Device")).not.toBeInTheDocument();
    });
  });

  describe("revoke all sessions", () => {
    // Helper to click the sessions tab (not the summary card)
    const clickSessionsTab = async (
      user: ReturnType<typeof userEvent.setup>,
    ) => {
      const tabs = screen.getAllByText("Active Sessions");
      await user.click(tabs[1]);
    };

    it("should show revoke all button when multiple sessions exist", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(
          screen.getByText("Revoke All Other Sessions"),
        ).toBeInTheDocument();
      });
    });

    it("should show confirmation dialog when revoke all is clicked", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ActivityPage />);

      await clickSessionsTab(user);

      await waitFor(() => {
        expect(
          screen.getByText("Revoke All Other Sessions"),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByText("Revoke All Other Sessions"));

      expect(globalThis.confirm).toHaveBeenCalledWith(
        "Are you sure you want to revoke all other sessions? You will need to sign in again on those devices.",
      );
    });
  });

  describe("pagination", () => {
    it("should show pagination when there are more items", () => {
      mockActivityLogQuery = {
        ...mockActivityLogQuery,
        data: {
          myActivityLog: {
            ...mockActivityLog,
            total: 25,
            hasMore: true,
          },
        },
      };

      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Showing 1-10 of 25")).toBeInTheDocument();
      expect(screen.getByText("Previous")).toBeInTheDocument();
      expect(screen.getByText("Next")).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      mockActivityLogQuery = {
        ...mockActivityLogQuery,
        data: {
          myActivityLog: {
            ...mockActivityLog,
            total: 25,
            hasMore: true,
          },
        },
      };

      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });
  });

  describe("error handling", () => {
    it("should show error message when activity log fails", () => {
      mockActivityLogQuery = {
        ...mockActivityLogQuery,
        data: null as unknown as typeof mockActivityLogQuery.data,
        error: new Error("Failed to load"),
      };

      renderWithI18n(<ActivityPage />);

      expect(
        screen.getByText("Failed to load activity. Please try again."),
      ).toBeInTheDocument();
    });

    it("should show retry button when query fails", () => {
      mockActivityLogQuery = {
        ...mockActivityLogQuery,
        data: null as unknown as typeof mockActivityLogQuery.data,
        error: new Error("Failed to load"),
      };

      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("Try Again")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no activity", () => {
      mockActivityLogQuery = {
        ...mockActivityLogQuery,
        data: {
          myActivityLog: {
            items: [],
            total: 0,
            hasMore: false,
          },
        },
      };

      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("No activity recorded yet")).toBeInTheDocument();
    });

    it("should show empty message when no sessions", async () => {
      const user = userEvent.setup();
      mockSessionsQuery = {
        ...mockSessionsQuery,
        data: {
          mySessions: {
            items: [],
            total: 0,
          },
        },
      };

      renderWithI18n(<ActivityPage />);

      // Click the sessions tab (second "Active Sessions" text)
      const tabs = screen.getAllByText("Active Sessions");
      await user.click(tabs[1]);

      await waitFor(() => {
        expect(screen.getByText("No active sessions")).toBeInTheDocument();
      });
    });
  });

  describe("summary calculations", () => {
    it("should show 0% success rate when no actions", () => {
      mockActivitySummaryQuery = {
        ...mockActivitySummaryQuery,
        data: {
          myActivitySummary: {
            totalActions: 0,
            successfulActions: 0,
            failedActions: 0,
            activeSessions: 0,
          },
        },
      };

      renderWithI18n(<ActivityPage />);

      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.getByText("Never")).toBeInTheDocument();
    });
  });
});
