import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import AddPasskeyPage from "@/app/(auth)/register/add-passkey/page";

// Mock Next.js router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock auth context
const mockRegisterPasskey = jest.fn();
const mockClearError = jest.fn();

const defaultAuthContext = {
  registerPasskey: mockRegisterPasskey,
  user: { id: "user-123", email: "test@example.com", roles: ["user"] },
  isLoading: false,
  error: null,
  clearError: mockClearError,
  supportsPasskeys: true,
  // Other required context values
  tokens: null,
  isAuthenticated: true,
  login: jest.fn(),
  loginWithPasskey: jest.fn(),
  sendMagicLink: jest.fn(),
  verifyMagicLink: jest.fn(),
  register: jest.fn(),
  registerWithMagicLink: jest.fn(),
  logout: jest.fn(),
  magicLinkSent: false,
  hasPlatformAuthenticator: true,
};

let mockAuthContextValue = { ...defaultAuthContext };

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockAuthContextValue,
}));

describe("AddPasskeyPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContextValue = { ...defaultAuthContext };
  });

  describe("when passkeys are supported", () => {
    it("should render the add passkey page header", () => {
      render(<AddPasskeyPage />);

      expect(screen.getByText("Add a Passkey")).toBeInTheDocument();
      expect(
        screen.getByText("Set up faster, more secure sign-in for your account"),
      ).toBeInTheDocument();
    });

    it("should render passkey benefits", () => {
      render(<AddPasskeyPage />);

      expect(screen.getByText("More secure")).toBeInTheDocument();
      expect(screen.getByText("Instant sign-in")).toBeInTheDocument();
      expect(screen.getByText("Works across devices")).toBeInTheDocument();
    });

    it("should render friendly name input", () => {
      render(<AddPasskeyPage />);

      expect(
        screen.getByLabelText(/Passkey Name \(Optional\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("e.g., MacBook Pro, iPhone"),
      ).toBeInTheDocument();
    });

    it("should render create passkey button", () => {
      render(<AddPasskeyPage />);

      expect(
        screen.getByRole("button", { name: /Create Passkey/i }),
      ).toBeInTheDocument();
    });

    it("should render skip button", () => {
      render(<AddPasskeyPage />);

      expect(
        screen.getByRole("button", { name: "Skip for now" }),
      ).toBeInTheDocument();
    });

    it("should render settings note", () => {
      render(<AddPasskeyPage />);

      expect(
        screen.getByText(
          /You can add more passkeys later in your account settings/,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when passkeys are not supported", () => {
    beforeEach(() => {
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: false };
    });

    it("should show not supported message", () => {
      render(<AddPasskeyPage />);

      expect(screen.getByText("Passkeys not supported")).toBeInTheDocument();
      expect(
        screen.getByText(/Your browser or device doesn't support passkeys yet/),
      ).toBeInTheDocument();
    });

    it("should show continue to app button", () => {
      render(<AddPasskeyPage />);

      expect(
        screen.getByRole("button", { name: "Continue to App" }),
      ).toBeInTheDocument();
    });

    it("should navigate to onboarding when continue is clicked", async () => {
      render(<AddPasskeyPage />);

      const continueButton = screen.getByRole("button", {
        name: "Continue to App",
      });
      await userEvent.click(continueButton);

      expect(mockPush).toHaveBeenCalledWith("/onboarding");
    });
  });

  describe("passkey registration", () => {
    it("should call registerPasskey when create button is clicked", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      render(<AddPasskeyPage />);

      const createButton = screen.getByRole("button", {
        name: /Create Passkey/i,
      });
      await userEvent.click(createButton);

      expect(mockClearError).toHaveBeenCalled();
      expect(mockRegisterPasskey).toHaveBeenCalledWith(
        "test@example.com",
        undefined,
      );
    });

    it("should pass friendly name to registerPasskey when provided", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      render(<AddPasskeyPage />);

      const nameInput = screen.getByLabelText(/Passkey Name \(Optional\)/i);
      await userEvent.type(nameInput, "MacBook Pro");

      const createButton = screen.getByRole("button", {
        name: /Create Passkey/i,
      });
      await userEvent.click(createButton);

      expect(mockRegisterPasskey).toHaveBeenCalledWith(
        "test@example.com",
        "MacBook Pro",
      );
    });

    it("should not call registerPasskey when user email is missing", async () => {
      mockAuthContextValue = { ...defaultAuthContext, user: null };
      render(<AddPasskeyPage />);

      const createButton = screen.getByRole("button", {
        name: /Create Passkey/i,
      });
      await userEvent.click(createButton);

      expect(mockRegisterPasskey).not.toHaveBeenCalled();
    });
  });

  describe("success state", () => {
    it("should show success message after passkey is added", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      render(<AddPasskeyPage />);

      const createButton = screen.getByRole("button", {
        name: /Create Passkey/i,
      });
      await userEvent.click(createButton);

      await waitFor(() => {
        expect(screen.getByText("Passkey added!")).toBeInTheDocument();
      });
    });

    it("should show success description", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      render(<AddPasskeyPage />);

      const createButton = screen.getByRole("button", {
        name: /Create Passkey/i,
      });
      await userEvent.click(createButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            /You can now sign in instantly with your fingerprint, face, or device PIN/,
          ),
        ).toBeInTheDocument();
      });
    });

    it("should show continue to app button in success state", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      render(<AddPasskeyPage />);

      const createButton = screen.getByRole("button", {
        name: /Create Passkey/i,
      });
      await userEvent.click(createButton);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Continue to App" }),
        ).toBeInTheDocument();
      });
    });

    it("should navigate to onboarding from success state", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      render(<AddPasskeyPage />);

      const createButton = screen.getByRole("button", {
        name: /Create Passkey/i,
      });
      await userEvent.click(createButton);

      await waitFor(() => {
        expect(screen.getByText("Passkey added!")).toBeInTheDocument();
      });

      const continueButton = screen.getByRole("button", {
        name: "Continue to App",
      });
      await userEvent.click(continueButton);

      expect(mockPush).toHaveBeenCalledWith("/onboarding");
    });
  });

  describe("skip functionality", () => {
    it("should navigate to onboarding when skip is clicked", async () => {
      render(<AddPasskeyPage />);

      const skipButton = screen.getByRole("button", { name: "Skip for now" });
      await userEvent.click(skipButton);

      expect(mockPush).toHaveBeenCalledWith("/onboarding");
    });
  });

  describe("error handling", () => {
    it("should display error message when error exists", () => {
      mockAuthContextValue = {
        ...defaultAuthContext,
        error: "Failed to register passkey",
      };
      render(<AddPasskeyPage />);

      expect(
        screen.getByText("Failed to register passkey"),
      ).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("should show loading state when isLoading is true", () => {
      mockAuthContextValue = { ...defaultAuthContext, isLoading: true };
      render(<AddPasskeyPage />);

      expect(screen.getByText("Creating passkey...")).toBeInTheDocument();
    });

    it("should disable create button when loading", () => {
      mockAuthContextValue = { ...defaultAuthContext, isLoading: true };
      render(<AddPasskeyPage />);

      const createButton = screen.getByRole("button", {
        name: /Creating passkey/i,
      });
      expect(createButton).toBeDisabled();
    });
  });
});
