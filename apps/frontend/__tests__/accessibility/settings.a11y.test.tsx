/**
 * WCAG 2.2 AA Accessibility Tests for Settings Pages
 *
 * These tests use jest-axe to verify that settings pages meet WCAG 2.2 Level AA standards.
 * Tests cover:
 * - Profile settings
 * - Addresses page
 * - Notifications page
 * - Privacy page
 * - Security page
 */

import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

// Import pages
import ProfileSettingsPage from "@/app/settings/page";
import AddressesPage from "@/app/settings/addresses/page";
import NotificationsPage from "@/app/settings/notifications/page";
import PrivacyPage from "@/app/settings/privacy/page";
import SecurityPage from "@/app/settings/security/page";
import { I18nProvider } from "@/lib/i18n/context";

expect.extend(toHaveNoViolations);

// Mock data
const mockProfile = {
  id: "user-1",
  email: "test@example.com",
  firstName: "John",
  lastName: "Doe",
  displayName: "JohnD",
  phoneNumber: "+1 555-123-4567",
  timezone: "America/Los_Angeles",
  bio: "Test bio",
  preferredLanguage: "en",
  emailVerified: true,
  phoneVerified: false,
};

const mockAddresses = [
  {
    id: "addr-1",
    userId: "user-1",
    addressType: "residential",
    isPrimary: true,
    label: "Home",
    addressLine1: "123 Main St",
    addressLine2: "Apt 4",
    city: "San Francisco",
    state: "CA",
    postalCode: "94102",
    country: "US",
    isVerified: true,
    congressionalDistrict: "CA-12",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

const mockNotificationSettings = {
  id: "1",
  userId: "user-1",
  emailNotifications: true,
  pushNotifications: false,
  smsNotifications: false,
  emailFrequency: "instant",
  civicAlerts: true,
  legislativeUpdates: true,
  electionReminders: true,
  representativeNews: false,
};

const mockConsents = [
  {
    id: "1",
    userId: "user-1",
    consentType: "terms_of_service",
    status: "granted",
    version: "1.0",
    grantedAt: "2024-01-01T00:00:00Z",
    withdrawnAt: null,
    deniedAt: null,
  },
];

// Setup mocks
let mockProfileQuery = {
  data: { myProfile: mockProfile },
  loading: false,
  error: null,
};
let mockProfileCompletionQuery = {
  data: {
    myProfileCompletion: {
      percentage: 75,
      isComplete: false,
      coreFieldsComplete: {
        hasName: true,
        hasPhoto: false,
        hasTimezone: true,
        hasAddress: true,
      },
      suggestedNextSteps: ["Add a profile photo"],
    },
  },
  loading: false,
  error: null,
};
let mockAddressesQuery = {
  data: { myAddresses: mockAddresses },
  loading: false,
  error: null,
  refetch: jest.fn(),
};
let mockNotificationsQuery = {
  data: { myNotificationSettings: mockNotificationSettings },
  loading: false,
  error: null,
  refetch: jest.fn(),
};
let mockConsentsQuery = {
  data: { myConsents: mockConsents },
  loading: false,
  error: null,
  refetch: jest.fn(),
};

jest.mock("@apollo/client/react", () => ({
  useQuery: (query: unknown) => {
    const queryModule = require("@/lib/graphql/profile");
    if (query === queryModule.GET_MY_PROFILE) return mockProfileQuery;
    if (query === queryModule.GET_MY_PROFILE_COMPLETION)
      return mockProfileCompletionQuery;
    if (query === queryModule.GET_MY_ADDRESSES) return mockAddressesQuery;
    if (query === queryModule.GET_MY_NOTIFICATION_SETTINGS)
      return mockNotificationsQuery;
    if (query === queryModule.GET_MY_CONSENTS) return mockConsentsQuery;
    return { data: null, loading: false, error: null };
  },
  useMutation: () => [jest.fn(), { loading: false }],
  useLazyQuery: () => [jest.fn(), { data: null, loading: false, error: null }],
}));

// Mock @apollo/client for components that import directly from it
jest.mock("@apollo/client", () => ({
  ...jest.requireActual("@apollo/client"),
  useLazyQuery: () => [jest.fn(), { data: null, loading: false, error: null }],
  useMutation: () => [jest.fn(), { loading: false }],
}));

// Mock auth context for security page
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "test@example.com", roles: ["user"] },
    isLoading: false,
    error: null,
    clearError: jest.fn(),
    supportsPasskeys: true,
    tokens: null,
    isAuthenticated: true,
    login: jest.fn(),
    loginWithPasskey: jest.fn(),
    sendMagicLink: jest.fn(),
    verifyMagicLink: jest.fn(),
    register: jest.fn(),
    registerPasskey: jest.fn(),
    registerWithMagicLink: jest.fn(),
    logout: jest.fn(),
    magicLinkSent: false,
    hasPlatformAuthenticator: true,
  }),
}));

// Mock passkey hook for security page
jest.mock("@/lib/hooks/usePasskey", () => ({
  usePasskey: () => ({
    passkeys: [],
    passkeysLoading: false,
    isLoading: false,
    error: null,
    supportsPasskeys: true,
    registerPasskey: jest.fn(),
    deletePasskey: jest.fn(),
    authenticateWithPasskey: jest.fn(),
    refetchPasskeys: jest.fn(),
    clearError: jest.fn(),
  }),
}));

const renderWithI18n = (ui: React.ReactElement) => {
  return render(<I18nProvider>{ui}</I18nProvider>);
};

describe("Settings Pages Accessibility (WCAG 2.2 AA)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock data
    mockProfileQuery = {
      data: { myProfile: mockProfile },
      loading: false,
      error: null,
    };
    mockAddressesQuery = {
      data: { myAddresses: mockAddresses },
      loading: false,
      error: null,
      refetch: jest.fn(),
    };
    mockNotificationsQuery = {
      data: { myNotificationSettings: mockNotificationSettings },
      loading: false,
      error: null,
      refetch: jest.fn(),
    };
    mockConsentsQuery = {
      data: { myConsents: mockConsents },
      loading: false,
      error: null,
      refetch: jest.fn(),
    };
    globalThis.confirm = jest.fn(() => true);
    globalThis.alert = jest.fn();
  });

  describe("Profile Settings Page", () => {
    it("should have no accessibility violations", async () => {
      const { container } = renderWithI18n(<ProfileSettingsPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have properly labeled form fields", () => {
      renderWithI18n(<ProfileSettingsPage />);

      expect(screen.getByLabelText("First Name")).toBeInTheDocument();
      expect(screen.getByLabelText("Last Name")).toBeInTheDocument();
      expect(screen.getByLabelText("Display Name")).toBeInTheDocument();
      expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
      expect(screen.getByLabelText("Timezone")).toBeInTheDocument();
      expect(screen.getByLabelText("Bio")).toBeInTheDocument();
      expect(screen.getByLabelText("Language")).toBeInTheDocument();
    });

    it("should have accessible button with clear text", () => {
      renderWithI18n(<ProfileSettingsPage />);

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeInTheDocument();
    });
  });

  describe("Addresses Page", () => {
    it("should have no accessibility violations", async () => {
      const { container } = renderWithI18n(<AddressesPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have accessible icon buttons with aria-labels", () => {
      renderWithI18n(<AddressesPage />);

      // Edit and Delete buttons should have aria-labels
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Delete" }),
      ).toBeInTheDocument();
    });

    it("should have accessible Add Address button", () => {
      renderWithI18n(<AddressesPage />);

      expect(
        screen.getByRole("button", { name: "Add Address" }),
      ).toBeInTheDocument();
    });
  });

  describe("Notifications Page", () => {
    it("should have no accessibility violations", async () => {
      const { container } = renderWithI18n(<NotificationsPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have accessible toggle buttons with proper structure", () => {
      const { container } = renderWithI18n(<NotificationsPage />);

      // All buttons should have accessible names
      const buttons = container.querySelectorAll("button");
      buttons.forEach((button) => {
        const hasText = button.textContent?.trim() !== "";
        const hasAriaLabel = button.hasAttribute("aria-label");
        expect(hasText || hasAriaLabel).toBeTruthy();
      });
    });
  });

  describe("Privacy Page", () => {
    it("should have no accessibility violations", async () => {
      const { container } = renderWithI18n(<PrivacyPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have decorative icons hidden from screen readers", () => {
      const { container } = renderWithI18n(<PrivacyPage />);

      // All decorative SVGs should have aria-hidden="true"
      const svgs = container.querySelectorAll("svg");
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute("aria-hidden", "true");
      });
    });
  });

  describe("Security Page", () => {
    it("should have no accessibility violations", async () => {
      const { container } = renderWithI18n(<SecurityPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have decorative icons hidden from screen readers", () => {
      const { container } = renderWithI18n(<SecurityPage />);

      // All decorative SVGs should have aria-hidden="true"
      const svgs = container.querySelectorAll("svg");
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute("aria-hidden", "true");
      });
    });

    it("should have accessible buttons", () => {
      renderWithI18n(<SecurityPage />);

      expect(
        screen.getByRole("button", { name: /Add Passkey/i }),
      ).toBeInTheDocument();
    });
  });

  describe("Loading States", () => {
    it("Profile page loading state should have no violations", async () => {
      mockProfileQuery = { data: null, loading: true, error: null };
      const { container } = renderWithI18n(<ProfileSettingsPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("Addresses page loading state should have no violations", async () => {
      mockAddressesQuery = {
        data: null,
        loading: true,
        error: null,
        refetch: jest.fn(),
      };
      const { container } = renderWithI18n(<AddressesPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("Privacy page loading state should have no violations", async () => {
      mockConsentsQuery = {
        data: null,
        loading: true,
        error: null,
        refetch: jest.fn(),
      };
      const { container } = renderWithI18n(<PrivacyPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Error States", () => {
    it("Profile page error state should have no violations", async () => {
      mockProfileQuery = {
        data: null,
        loading: false,
        error: new Error("Failed"),
      };
      const { container } = renderWithI18n(<ProfileSettingsPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("Addresses page error state should have no violations", async () => {
      mockAddressesQuery = {
        data: null,
        loading: false,
        error: new Error("Failed"),
        refetch: jest.fn(),
      };
      const { container } = renderWithI18n(<AddressesPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
