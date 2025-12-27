import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import ProfileSettingsPage from "@/app/settings/page";
import { I18nProvider } from "@/lib/i18n/context";

const renderWithI18n = (ui: React.ReactElement) => {
  return render(<I18nProvider>{ui}</I18nProvider>);
};

// Mock Apollo Client
const mockRefetch = jest.fn();
const mockUpdateProfile = jest.fn();

let mockProfileQueryResult = {
  data: null as { myProfile: unknown } | null,
  loading: false,
  error: null as Error | null,
  refetch: mockRefetch,
};

let mockCompletionQueryResult = {
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
  error: null as Error | null,
  refetch: jest.fn(),
};

let mockMutationResult = {
  loading: false,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: (query: unknown) => {
    const queryModule = require("@/lib/graphql/profile");
    if (query === queryModule.GET_MY_PROFILE) return mockProfileQueryResult;
    if (query === queryModule.GET_MY_PROFILE_COMPLETION)
      return mockCompletionQueryResult;
    return { data: null, loading: false, error: null };
  },
  useMutation: () => [mockUpdateProfile, mockMutationResult],
  useLazyQuery: () => [jest.fn(), { data: null, loading: false, error: null }],
}));

// Mock @apollo/client for components that import directly from it
jest.mock("@apollo/client", () => ({
  ...jest.requireActual("@apollo/client"),
  useLazyQuery: () => [jest.fn(), { data: null, loading: false, error: null }],
  useMutation: () => [mockUpdateProfile, mockMutationResult],
}));

const mockProfile = {
  id: "profile-1",
  userId: "user-1",
  firstName: "John",
  lastName: "Doe",
  displayName: "JohnD",
  preferredName: "Johnny",
  phone: "+1 555-123-4567",
  timezone: "America/Los_Angeles",
  preferredLanguage: "en",
  bio: "Test bio",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("ProfileSettingsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfileQueryResult = {
      data: { myProfile: mockProfile },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    mockCompletionQueryResult = {
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
      refetch: jest.fn(),
    };
    mockMutationResult = { loading: false };
  });

  describe("loading state", () => {
    it("should show loading skeleton when data is loading", () => {
      mockProfileQueryResult = {
        data: null,
        loading: true,
        error: null,
        refetch: mockRefetch,
      };

      const { container } = render(<ProfileSettingsPage />);

      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("should show error message when query fails", () => {
      mockProfileQueryResult = {
        data: null,
        loading: false,
        error: new Error("Failed to load"),
        refetch: mockRefetch,
      };

      render(<ProfileSettingsPage />);

      expect(
        screen.getByText("Failed to load profile. Please try again."),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render the profile settings header", () => {
      renderWithI18n(<ProfileSettingsPage />);

      expect(screen.getByText("Profile Settings")).toBeInTheDocument();
      expect(
        screen.getByText("Manage your personal information and preferences"),
      ).toBeInTheDocument();
    });

    it("should render form fields with profile data", () => {
      renderWithI18n(<ProfileSettingsPage />);

      expect(screen.getByLabelText("First Name")).toHaveValue("John");
      expect(screen.getByLabelText("Last Name")).toHaveValue("Doe");
      expect(screen.getByLabelText("Display Name")).toHaveValue("JohnD");
      expect(screen.getByLabelText("Phone Number")).toHaveValue(
        "+1 555-123-4567",
      );
      expect(screen.getByLabelText("Timezone")).toHaveValue(
        "America/Los_Angeles",
      );
      expect(screen.getByLabelText("Bio")).toHaveValue("Test bio");
    });

    it("should render save button", () => {
      renderWithI18n(<ProfileSettingsPage />);

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeInTheDocument();
    });
  });

  describe("form interactions", () => {
    it("should update field values when typing", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ProfileSettingsPage />);

      const firstNameInput = screen.getByLabelText("First Name");
      await user.clear(firstNameInput);
      await user.type(firstNameInput, "Jane");

      expect(firstNameInput).toHaveValue("Jane");
    });

    it("should call update mutation on form submit", async () => {
      const user = userEvent.setup();
      mockUpdateProfile.mockResolvedValueOnce({
        data: { updateMyProfile: mockProfile },
      });

      renderWithI18n(<ProfileSettingsPage />);

      const saveButton = screen.getByRole("button", { name: "Save Changes" });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          variables: {
            input: expect.objectContaining({
              firstName: "John",
              lastName: "Doe",
            }),
          },
        });
      });
    });

    it("should show success message after saving", async () => {
      const user = userEvent.setup();
      mockUpdateProfile.mockResolvedValueOnce({
        data: { updateMyProfile: mockProfile },
      });

      renderWithI18n(<ProfileSettingsPage />);

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(
          screen.getByText("Profile saved successfully!"),
        ).toBeInTheDocument();
      });
    });

    it("should show error message when save fails", async () => {
      const user = userEvent.setup();
      mockUpdateProfile.mockRejectedValueOnce(new Error("Save failed"));

      renderWithI18n(<ProfileSettingsPage />);

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(screen.getByText("Save failed")).toBeInTheDocument();
      });
    });

    it("should show saving state on button", async () => {
      mockMutationResult = { loading: true };

      renderWithI18n(<ProfileSettingsPage />);

      expect(
        screen.getByRole("button", { name: "Saving..." }),
      ).toBeInTheDocument();
    });
  });

  describe("timezone selection", () => {
    it("should render all timezone options", () => {
      renderWithI18n(<ProfileSettingsPage />);

      const timezoneSelect = screen.getByLabelText("Timezone");
      expect(timezoneSelect).toBeInTheDocument();

      expect(screen.getByText("Pacific Time (PT)")).toBeInTheDocument();
      expect(screen.getByText("Eastern Time (ET)")).toBeInTheDocument();
    });
  });

  describe("language selection", () => {
    it("should render language selector with options", () => {
      renderWithI18n(<ProfileSettingsPage />);

      const languageSelect = screen.getByLabelText("Language");
      expect(languageSelect).toBeInTheDocument();
      expect(languageSelect).toHaveValue("en");

      expect(screen.getByText("English")).toBeInTheDocument();
      expect(screen.getByText("Espanol")).toBeInTheDocument();
    });

    it("should update language when changed", async () => {
      const user = userEvent.setup();
      renderWithI18n(<ProfileSettingsPage />);

      const languageSelect = screen.getByLabelText("Language");
      await user.selectOptions(languageSelect, "es");

      expect(languageSelect).toHaveValue("es");
    });

    it("should include preferredLanguage in form submission", async () => {
      const user = userEvent.setup();
      mockUpdateProfile.mockResolvedValueOnce({
        data: { updateMyProfile: mockProfile },
      });

      renderWithI18n(<ProfileSettingsPage />);

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          variables: {
            input: expect.objectContaining({
              preferredLanguage: "en",
            }),
          },
        });
      });
    });
  });
});
