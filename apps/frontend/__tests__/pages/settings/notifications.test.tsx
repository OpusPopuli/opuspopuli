import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import NotificationsPage from "@/app/settings/notifications/page";

// Mock Apollo Client
const mockRefetch = jest.fn();
const mockUpdatePreferences = jest.fn();
const mockUnsubscribeAll = jest.fn();

let mockQueryResult = {
  data: null as { myNotificationPreferences: unknown } | null,
  loading: false,
  error: null as Error | null,
  refetch: mockRefetch,
};

const mockMutationResults = {
  update: { loading: false },
  unsubscribe: { loading: false },
};

jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockQueryResult,
  useMutation: (mutation: unknown) => {
    if (
      mutation ===
      require("@/lib/graphql/profile").UPDATE_NOTIFICATION_PREFERENCES
    ) {
      return [mockUpdatePreferences, mockMutationResults.update];
    }
    if (mutation === require("@/lib/graphql/profile").UNSUBSCRIBE_FROM_ALL) {
      return [mockUnsubscribeAll, mockMutationResults.unsubscribe];
    }
    return [jest.fn(), { loading: false }];
  },
}));

const mockPreferences = {
  id: "pref-1",
  userId: "user-1",
  emailEnabled: true,
  emailProductUpdates: true,
  emailSecurityAlerts: true,
  emailMarketing: false,
  emailFrequency: "immediate",
  pushEnabled: true,
  pushProductUpdates: true,
  pushSecurityAlerts: true,
  pushMarketing: false,
  smsEnabled: false,
  smsSecurityAlerts: false,
  smsMarketing: false,
  civicElectionReminders: true,
  civicVoterDeadlines: true,
  civicBallotUpdates: true,
  civicLocalNews: false,
  civicRepresentativeUpdates: true,
  civicFrequency: "daily_digest",
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("NotificationsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { myNotificationPreferences: mockPreferences },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    globalThis.confirm = jest.fn(() => true);
    globalThis.alert = jest.fn();
  });

  describe("loading state", () => {
    it("should show loading skeleton when data is loading", () => {
      mockQueryResult = {
        data: null,
        loading: true,
        error: null,
        refetch: mockRefetch,
      };

      const { container } = render(<NotificationsPage />);

      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("should show error message when query fails", () => {
      mockQueryResult = {
        data: null,
        loading: false,
        error: new Error("Failed to load"),
        refetch: mockRefetch,
      };

      render(<NotificationsPage />);

      expect(
        screen.getByText("Failed to load preferences. Please try again."),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render the page header", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Notification Preferences")).toBeInTheDocument();
      expect(
        screen.getByText("Choose how and when you want to be notified"),
      ).toBeInTheDocument();
    });

    it("should render email notifications section", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Email Notifications")).toBeInTheDocument();
      // Product updates and Security alerts appear in both Email and Push sections
      expect(screen.getAllByText("Product updates")).toHaveLength(2);
      expect(screen.getAllByText("Security alerts")).toHaveLength(2);
      // Marketing only appears in Email section
      expect(screen.getByText("Marketing")).toBeInTheDocument();
    });

    it("should render push notifications section", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Push Notifications")).toBeInTheDocument();
    });

    it("should render civic notifications section", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Civic Notifications")).toBeInTheDocument();
      expect(screen.getByText("Election reminders")).toBeInTheDocument();
      expect(screen.getByText("Voter deadlines")).toBeInTheDocument();
      expect(screen.getByText("Ballot updates")).toBeInTheDocument();
      expect(screen.getByText("Local news")).toBeInTheDocument();
      expect(screen.getByText("Representative updates")).toBeInTheDocument();
    });

    it("should render quiet hours section", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Quiet Hours")).toBeInTheDocument();
      expect(
        screen.getByText("Pause notifications during specific times"),
      ).toBeInTheDocument();
    });

    it("should render unsubscribe button", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Unsubscribe from all")).toBeInTheDocument();
    });

    it("should render save button", () => {
      render(<NotificationsPage />);

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeInTheDocument();
    });
  });

  describe("toggle interactions", () => {
    it("should enable save button after making changes", async () => {
      const user = userEvent.setup();
      render(<NotificationsPage />);

      // Save button should be disabled initially (no changes)
      const saveButton = screen.getByRole("button", { name: "Save Changes" });
      expect(saveButton).toBeDisabled();

      // Find and click a toggle (using the Marketing toggle since it's off)
      const toggles = screen.getAllByRole("button", { name: "" });
      const marketingToggle = toggles.find(
        (btn) =>
          btn.classList.contains("bg-surface-sunk") &&
          btn.classList.contains("rounded-full"),
      );

      if (marketingToggle) {
        await user.click(marketingToggle);
        expect(saveButton).not.toBeDisabled();
      }
    });
  });

  describe("save preferences", () => {
    it("should call update mutation on save", async () => {
      const user = userEvent.setup();
      mockUpdatePreferences.mockResolvedValueOnce({
        data: { updateNotificationPreferences: mockPreferences },
      });

      render(<NotificationsPage />);

      // Enable a toggle to enable save button
      const toggles = screen.getAllByRole("button", { name: "" });
      const marketingToggle = toggles.find(
        (btn) =>
          btn.classList.contains("bg-surface-sunk") &&
          btn.classList.contains("rounded-full"),
      );

      if (marketingToggle) {
        await user.click(marketingToggle);
      }

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalled();
      });
    });

    it("should show success message after saving", async () => {
      const user = userEvent.setup();
      mockUpdatePreferences.mockResolvedValueOnce({
        data: { updateNotificationPreferences: mockPreferences },
      });

      render(<NotificationsPage />);

      // Enable a toggle to enable save button
      const toggles = screen.getAllByRole("button", { name: "" });
      const marketingToggle = toggles.find(
        (btn) =>
          btn.classList.contains("bg-surface-sunk") &&
          btn.classList.contains("rounded-full"),
      );

      if (marketingToggle) {
        await user.click(marketingToggle);
      }

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(
          screen.getByText("Preferences saved successfully!"),
        ).toBeInTheDocument();
      });
    });

    it("should show error message when save fails", async () => {
      const user = userEvent.setup();
      mockUpdatePreferences.mockRejectedValueOnce(new Error("Save failed"));

      render(<NotificationsPage />);

      // Enable a toggle to enable save button
      const toggles = screen.getAllByRole("button", { name: "" });
      const marketingToggle = toggles.find(
        (btn) =>
          btn.classList.contains("bg-surface-sunk") &&
          btn.classList.contains("rounded-full"),
      );

      if (marketingToggle) {
        await user.click(marketingToggle);
      }

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(screen.getByText("Save failed")).toBeInTheDocument();
      });
    });
  });

  describe("unsubscribe from all", () => {
    it("should show confirmation before unsubscribing", async () => {
      const user = userEvent.setup();
      render(<NotificationsPage />);

      await user.click(screen.getByText("Unsubscribe from all"));

      expect(globalThis.confirm).toHaveBeenCalledWith(
        "Are you sure you want to unsubscribe from all notifications?",
      );
    });

    it("should call unsubscribe mutation when confirmed", async () => {
      const user = userEvent.setup();
      mockUnsubscribeAll.mockResolvedValueOnce({
        data: { unsubscribeFromAll: mockPreferences },
      });

      render(<NotificationsPage />);

      await user.click(screen.getByText("Unsubscribe from all"));

      await waitFor(() => {
        expect(mockUnsubscribeAll).toHaveBeenCalled();
      });
    });

    it("should not unsubscribe when cancelled", async () => {
      const user = userEvent.setup();
      (globalThis.confirm as jest.Mock).mockReturnValueOnce(false);

      render(<NotificationsPage />);

      await user.click(screen.getByText("Unsubscribe from all"));

      expect(mockUnsubscribeAll).not.toHaveBeenCalled();
    });
  });

  describe("quiet hours", () => {
    it("should show time inputs when quiet hours is enabled", async () => {
      mockQueryResult = {
        data: {
          myNotificationPreferences: {
            ...mockPreferences,
            quietHoursEnabled: true,
            quietHoursStart: "22:00",
            quietHoursEnd: "08:00",
          },
        },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<NotificationsPage />);

      expect(screen.getByText("From")).toBeInTheDocument();
      expect(screen.getByText("To")).toBeInTheDocument();
      expect(screen.getByDisplayValue("22:00")).toBeInTheDocument();
      expect(screen.getByDisplayValue("08:00")).toBeInTheDocument();
    });
  });

  describe("frequency selectors", () => {
    it("should render email frequency selector", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Email frequency")).toBeInTheDocument();
      const frequencySelect = screen.getAllByRole("combobox")[0];
      expect(frequencySelect).toHaveValue("immediate");
    });

    it("should render civic frequency selector", () => {
      render(<NotificationsPage />);

      expect(screen.getByText("Civic update frequency")).toBeInTheDocument();
      const frequencySelects = screen.getAllByRole("combobox");
      expect(frequencySelects[1]).toHaveValue("daily_digest");
    });
  });
});
