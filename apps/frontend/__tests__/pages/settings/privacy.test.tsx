import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PrivacyPage from "@/app/settings/privacy/page";

// Mock Apollo Client
const mockRefetch = jest.fn();
const mockUpdateConsent = jest.fn();
const mockWithdrawConsent = jest.fn();
const mockExportMyData = jest.fn();

let mockQueryResult = {
  data: null as { myConsents: unknown[] } | null,
  loading: false,
  error: null as Error | null,
  refetch: mockRefetch,
};

const mockMutationResults = {
  update: { loading: false },
  withdraw: { loading: false },
  export: { loading: false },
};

jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockQueryResult,
  useMutation: (mutation: unknown) => {
    if (mutation === require("@/lib/graphql/profile").UPDATE_CONSENT) {
      return [mockUpdateConsent, mockMutationResults.update];
    }
    if (mutation === require("@/lib/graphql/profile").WITHDRAW_CONSENT) {
      return [mockWithdrawConsent, mockMutationResults.withdraw];
    }
    if (mutation === require("@/lib/graphql/profile").EXPORT_MY_DATA) {
      return [mockExportMyData, mockMutationResults.export];
    }
    return [jest.fn(), { loading: false }];
  },
}));

const mockConsents = [
  {
    id: "consent-1",
    userId: "user-1",
    consentType: "terms_of_service",
    status: "granted",
    grantedAt: "2024-01-01T00:00:00Z",
    deniedAt: null,
    withdrawnAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "consent-2",
    userId: "user-1",
    consentType: "privacy_policy",
    status: "granted",
    grantedAt: "2024-01-01T00:00:00Z",
    deniedAt: null,
    withdrawnAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "consent-3",
    userId: "user-1",
    consentType: "marketing_email",
    status: "denied",
    grantedAt: null,
    deniedAt: "2024-01-01T00:00:00Z",
    withdrawnAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "consent-4",
    userId: "user-1",
    consentType: "analytics",
    status: "granted",
    grantedAt: "2024-01-01T00:00:00Z",
    deniedAt: null,
    withdrawnAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

describe("PrivacyPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { myConsents: mockConsents },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
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

      const { container } = render(<PrivacyPage />);

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

      render(<PrivacyPage />);

      expect(
        screen.getByText(
          "Failed to load consent preferences. Please try again.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render the page header", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Privacy & Consent")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Manage your privacy settings and data consent preferences",
        ),
      ).toBeInTheDocument();
    });

    it("should render GDPR/CCPA notice", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Your Privacy Rights")).toBeInTheDocument();
      expect(
        screen.getByText(/Under GDPR and CCPA, you have the right/),
      ).toBeInTheDocument();
    });

    it("should render Legal Agreements section", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Legal Agreements")).toBeInTheDocument();
      expect(screen.getByText("Terms of Service")).toBeInTheDocument();
      expect(screen.getByText("Privacy Policy")).toBeInTheDocument();
    });

    it("should render Marketing Communications section", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Marketing Communications")).toBeInTheDocument();
      expect(screen.getByText("Email Marketing")).toBeInTheDocument();
      expect(screen.getByText("SMS Marketing")).toBeInTheDocument();
      expect(screen.getByText("Push Notifications")).toBeInTheDocument();
    });

    it("should render Data & Analytics section", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Data & Analytics")).toBeInTheDocument();
      expect(screen.getByText("Analytics")).toBeInTheDocument();
      expect(screen.getByText("Personalization")).toBeInTheDocument();
      expect(screen.getByText("Data Sharing")).toBeInTheDocument();
      expect(screen.getByText("Location Tracking")).toBeInTheDocument();
    });

    it("should render Civic Engagement section", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Civic Engagement")).toBeInTheDocument();
      expect(screen.getByText("Voter Data Collection")).toBeInTheDocument();
      expect(screen.getByText("Civic Notifications")).toBeInTheDocument();
      expect(screen.getByText("Representative Contact")).toBeInTheDocument();
    });

    it("should render Data Management section", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Data Management")).toBeInTheDocument();
      expect(screen.getByText("Export Your Data")).toBeInTheDocument();
      // Delete Account appears as both section title and button
      expect(
        screen.getAllByText("Delete Account").length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe("consent status badges", () => {
    it("should show Granted badge for granted consents", () => {
      render(<PrivacyPage />);

      const grantedBadges = screen.getAllByText("Granted");
      expect(grantedBadges.length).toBeGreaterThan(0);
    });

    it("should show Denied badge for denied consents", () => {
      render(<PrivacyPage />);

      expect(screen.getByText("Denied")).toBeInTheDocument();
    });

    it("should show Required badge for required consents", () => {
      render(<PrivacyPage />);

      const requiredBadges = screen.getAllByText("Required");
      expect(requiredBadges.length).toBe(2); // Terms and Privacy Policy
    });
  });

  describe("consent buttons", () => {
    it("should show Withdraw button for granted consents", () => {
      render(<PrivacyPage />);

      const withdrawButtons = screen.getAllByText("Withdraw");
      expect(withdrawButtons.length).toBeGreaterThan(0);
    });

    it("should show Grant button for non-granted consents", () => {
      render(<PrivacyPage />);

      const grantButtons = screen.getAllByText("Grant");
      expect(grantButtons.length).toBeGreaterThan(0);
    });

    it("should disable Withdraw button for required consents", () => {
      render(<PrivacyPage />);

      // Find the Terms of Service row and its Withdraw button
      const withdrawButtons = screen.getAllByRole("button", {
        name: "Withdraw",
      }) as HTMLButtonElement[];

      // The first two should be disabled (Terms and Privacy Policy are required)
      const disabledButtons = withdrawButtons.filter((btn) => btn.disabled);
      expect(disabledButtons.length).toBe(2);
    });
  });

  describe("consent interactions", () => {
    it("should call updateConsent when Grant is clicked", async () => {
      const user = userEvent.setup();
      mockUpdateConsent.mockResolvedValueOnce({
        data: { updateConsent: mockConsents[2] },
      });

      render(<PrivacyPage />);

      const grantButtons = screen.getAllByText("Grant");
      await user.click(grantButtons[0]);

      await waitFor(() => {
        expect(mockUpdateConsent).toHaveBeenCalledWith({
          variables: {
            input: expect.objectContaining({
              granted: true,
            }),
          },
        });
      });
    });

    it("should call withdrawConsent when Withdraw is clicked", async () => {
      const user = userEvent.setup();
      mockWithdrawConsent.mockResolvedValueOnce({
        data: { withdrawConsent: mockConsents[3] },
      });

      render(<PrivacyPage />);

      // Find a non-required Withdraw button (Analytics)
      const withdrawButtons = (
        screen.getAllByRole("button", {
          name: "Withdraw",
        }) as HTMLButtonElement[]
      ).filter((btn) => !btn.disabled);

      await user.click(withdrawButtons[0]);

      await waitFor(() => {
        expect(mockWithdrawConsent).toHaveBeenCalled();
      });
    });

    it("should show error alert when consent update fails", async () => {
      const user = userEvent.setup();
      mockUpdateConsent.mockRejectedValueOnce(new Error("Update failed"));

      render(<PrivacyPage />);

      const grantButtons = screen.getAllByText("Grant");
      await user.click(grantButtons[0]);

      await waitFor(() => {
        expect(globalThis.alert).toHaveBeenCalledWith("Update failed");
      });
    });
  });

  describe("data management buttons", () => {
    it("should render Request Export button", () => {
      render(<PrivacyPage />);

      expect(
        screen.getByRole("button", { name: "Request Export" }),
      ).toBeInTheDocument();
    });

    it("should render Delete Account button", () => {
      render(<PrivacyPage />);

      expect(
        screen.getByRole("button", { name: "Delete Account" }),
      ).toBeInTheDocument();
    });

    it("should call exportMyData and trigger download on export click", async () => {
      const user = userEvent.setup();
      const mockExportResult = {
        data: {
          exportMyData: {
            exportedAt: "2026-02-16T00:00:00.000Z",
            data: { account: { email: "test@example.com" } },
          },
        },
      };
      mockExportMyData.mockResolvedValueOnce(mockExportResult);

      // Mock URL.createObjectURL and URL.revokeObjectURL
      const mockUrl = "blob:http://localhost/mock-blob";
      globalThis.URL.createObjectURL = jest.fn().mockReturnValue(mockUrl);
      globalThis.URL.revokeObjectURL = jest.fn();

      // Mock createElement to capture the download link
      const mockClick = jest.fn();
      const originalCreateElement = document.createElement.bind(document);
      jest.spyOn(document, "createElement").mockImplementation((tag) => {
        if (tag === "a") {
          const el = originalCreateElement("a");
          el.click = mockClick;
          return el;
        }
        return originalCreateElement(tag);
      });

      render(<PrivacyPage />);

      const exportButton = screen.getByRole("button", {
        name: "Request Export",
      });
      await user.click(exportButton);

      await waitFor(() => {
        expect(mockExportMyData).toHaveBeenCalled();
        expect(mockClick).toHaveBeenCalled();
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(mockUrl);
      });

      jest.restoreAllMocks();
    });

    it("should show error alert when export fails", async () => {
      const user = userEvent.setup();
      mockExportMyData.mockRejectedValueOnce(new Error("Export failed"));

      render(<PrivacyPage />);

      const exportButton = screen.getByRole("button", {
        name: "Request Export",
      });
      await user.click(exportButton);

      await waitFor(() => {
        expect(globalThis.alert).toHaveBeenCalledWith("Export failed");
      });
    });
  });

  describe("consent dates", () => {
    it("should display consent granted date", () => {
      render(<PrivacyPage />);

      // Verify that granted consents have date displayed
      // The date "2024-01-01T00:00:00Z" may show as Dec 31, 2023 in local timezone
      const dateElements = screen.getAllByText(/Granted on/);
      expect(dateElements.length).toBeGreaterThan(0);
    });
  });
});
