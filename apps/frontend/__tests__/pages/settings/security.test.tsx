import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import SecurityPage from "@/app/settings/security/page";
import type { PasskeyCredential } from "@/lib/graphql/auth";

// Mock auth context
const mockClearAuthError = jest.fn();

const defaultAuthContext = {
  user: { id: "user-123", email: "test@example.com", roles: ["user"] },
  isLoading: false,
  error: null,
  clearError: mockClearAuthError,
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
};

let mockAuthContextValue = { ...defaultAuthContext };

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockAuthContextValue,
}));

// Feature flags — default to full options so existing tests cover passkey/2FA/password UI.
jest.mock("@/lib/features", () => ({ AUTH_FULL_OPTIONS: true }));

// Mock passkey hook
const mockRegisterPasskey = jest.fn();
const mockDeletePasskey = jest.fn();
const mockRefetchPasskeys = jest.fn();
const mockClearPasskeyError = jest.fn();

const defaultPasskeyHook: {
  passkeys: PasskeyCredential[];
  passkeysLoading: boolean;
  isLoading: boolean;
  error: string | null;
  supportsPasskeys: boolean;
  registerPasskey: jest.Mock;
  deletePasskey: jest.Mock;
  authenticateWithPasskey: jest.Mock;
  refetchPasskeys: jest.Mock;
  clearError: jest.Mock;
} = {
  passkeys: [],
  passkeysLoading: false,
  isLoading: false,
  error: null,
  supportsPasskeys: true,
  registerPasskey: mockRegisterPasskey,
  deletePasskey: mockDeletePasskey,
  authenticateWithPasskey: jest.fn(),
  refetchPasskeys: mockRefetchPasskeys,
  clearError: mockClearPasskeyError,
};

let mockPasskeyHookValue: typeof defaultPasskeyHook = { ...defaultPasskeyHook };

jest.mock("@/lib/hooks/usePasskey", () => ({
  usePasskey: () => mockPasskeyHookValue,
}));

describe("SecurityPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContextValue = { ...defaultAuthContext };
    mockPasskeyHookValue = { ...defaultPasskeyHook };
    globalThis.confirm = jest.fn(() => true);
    globalThis.alert = jest.fn();
  });

  describe("rendering", () => {
    it("should render the page header", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Security")).toBeInTheDocument();
      expect(
        screen.getByText("Manage your passkeys and active sessions"),
      ).toBeInTheDocument();
    });

    it("should render passkeys section", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Passkeys")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Secure, passwordless login using biometrics or security keys",
        ),
      ).toBeInTheDocument();
    });

    it("should render Add Passkey button", () => {
      render(<SecurityPage />);

      expect(
        screen.getByRole("button", { name: "Add Passkey" }),
      ).toBeInTheDocument();
    });

    it("should render empty passkeys state", () => {
      render(<SecurityPage />);

      expect(screen.getByText("No passkeys added yet")).toBeInTheDocument();
      expect(
        screen.getByText("Add a passkey for faster, more secure sign-in"),
      ).toBeInTheDocument();
    });

    it("should render passkey benefits info", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Why use passkeys?")).toBeInTheDocument();
      expect(
        screen.getByText("• Phishing-resistant - cannot be stolen or guessed"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("• No passwords to remember"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("• Use Face ID, Touch ID, or security keys"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("• Works across all your devices"),
      ).toBeInTheDocument();
    });

    it("should render active sessions section", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Active Sessions")).toBeInTheDocument();
      expect(
        screen.getByText("Devices currently signed in to your account"),
      ).toBeInTheDocument();
    });

    it("should render current session with badge", () => {
      render(<SecurityPage />);

      // Device name is detected from userAgent - in test environment it shows as detected value
      expect(screen.getByText("Current")).toBeInTheDocument();
      expect(screen.getByText("Active now")).toBeInTheDocument();
    });

    it("should render sign out all button", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Sign out all devices")).toBeInTheDocument();
    });

    it("should render sign out button for current session", () => {
      render(<SecurityPage />);

      expect(
        screen.getByRole("button", { name: "Sign Out" }),
      ).toBeInTheDocument();
    });

    it("should render note about other sessions", () => {
      render(<SecurityPage />);

      expect(
        screen.getByText(/To manage sessions on other devices/),
      ).toBeInTheDocument();
    });

    it("should render two-factor authentication section", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Two-Factor Authentication")).toBeInTheDocument();
      expect(
        screen.getByText("Add an extra layer of security to your account"),
      ).toBeInTheDocument();
    });

    it("should render authenticator app option", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Authenticator App")).toBeInTheDocument();
      expect(
        screen.getByText("Use an app like Google Authenticator or Authy"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Set Up" }),
      ).toBeInTheDocument();
    });

    it("should render recovery codes option", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Recovery Codes")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Backup codes for when you cannot access your authenticator",
        ),
      ).toBeInTheDocument();
    });

    it("should render password section", () => {
      render(<SecurityPage />);

      expect(screen.getByText("Password")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Legacy password authentication (optional when using passkeys)",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Change Password")).toBeInTheDocument();
    });
  });

  describe("passkeys loading state", () => {
    it("should show loading spinner when passkeys are loading", () => {
      mockPasskeyHookValue = { ...defaultPasskeyHook, passkeysLoading: true };
      render(<SecurityPage />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });
  });

  describe("passkeys display", () => {
    it("should display passkeys when they exist", () => {
      mockPasskeyHookValue = {
        ...defaultPasskeyHook,
        passkeys: [
          {
            id: "passkey-1",
            friendlyName: "My Work Laptop",
            deviceType: "platform",
            createdAt: "2024-01-15T10:00:00Z",
            lastUsedAt: "2024-01-20T14:00:00Z",
          },
        ],
      };
      render(<SecurityPage />);

      expect(screen.getByText("My Work Laptop")).toBeInTheDocument();
    });

    it("should show unnamed passkey when friendlyName is missing", () => {
      mockPasskeyHookValue = {
        ...defaultPasskeyHook,
        passkeys: [
          {
            id: "passkey-1",
            friendlyName: undefined,
            deviceType: "platform",
            createdAt: "2024-01-15T10:00:00Z",
            lastUsedAt: "2024-01-15T10:00:00Z",
          },
        ],
      };
      render(<SecurityPage />);

      expect(screen.getByText("Unnamed Passkey")).toBeInTheDocument();
    });
  });

  describe("passkeys not supported", () => {
    it("should show not supported warning when browser lacks WebAuthn", () => {
      mockPasskeyHookValue = { ...defaultPasskeyHook, supportsPasskeys: false };
      render(<SecurityPage />);

      expect(
        screen.getByText(
          "Your browser doesn't support passkeys. Please use a modern browser like Chrome, Safari, or Edge.",
        ),
      ).toBeInTheDocument();
    });

    it("should disable Add Passkey button when not supported", () => {
      mockPasskeyHookValue = { ...defaultPasskeyHook, supportsPasskeys: false };
      render(<SecurityPage />);

      const addButton = screen.getByRole("button", { name: "Add Passkey" });
      expect(addButton).toBeDisabled();
    });
  });

  describe("add passkey interaction", () => {
    it("should open add passkey modal when clicked", async () => {
      const user = userEvent.setup();
      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Add Passkey" }));

      expect(screen.getByText("Add a Passkey")).toBeInTheDocument();
      expect(screen.getByText("Passkey Name (Optional)")).toBeInTheDocument();
    });

    it("should call registerPasskey when form is submitted", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      const user = userEvent.setup();
      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Add Passkey" }));

      const nameInput = screen.getByPlaceholderText(
        "e.g., MacBook Pro, iPhone",
      );
      await user.type(nameInput, "My MacBook");

      // Click the modal's Add Passkey button (there are two buttons with this name now)
      const addButtons = screen.getAllByRole("button", { name: "Add Passkey" });
      await user.click(addButtons[addButtons.length - 1]);

      expect(mockClearPasskeyError).toHaveBeenCalled();
      expect(mockRegisterPasskey).toHaveBeenCalledWith(
        "test@example.com",
        "My MacBook",
      );
    });

    it("should close modal on successful registration", async () => {
      mockRegisterPasskey.mockResolvedValue(true);
      const user = userEvent.setup();
      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Add Passkey" }));

      const addButtons = screen.getAllByRole("button", { name: "Add Passkey" });
      await user.click(addButtons[addButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText("Add a Passkey")).not.toBeInTheDocument();
      });
    });

    it("should close modal when cancel is clicked", async () => {
      const user = userEvent.setup();
      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Add Passkey" }));
      expect(screen.getByText("Add a Passkey")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText("Add a Passkey")).not.toBeInTheDocument();
    });
  });

  describe("delete passkey interaction", () => {
    it("should show confirm button when remove is clicked", async () => {
      mockPasskeyHookValue = {
        ...defaultPasskeyHook,
        passkeys: [
          {
            id: "passkey-1",
            friendlyName: "MacBook Pro",
            deviceType: "platform",
            createdAt: "2024-01-15T10:00:00Z",
            lastUsedAt: "2024-01-15T10:00:00Z",
          },
        ],
      };
      const user = userEvent.setup();
      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Remove" }));

      expect(
        screen.getByRole("button", { name: "Confirm" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();
    });

    it("should call deletePasskey when confirmed", async () => {
      mockDeletePasskey.mockResolvedValue(true);
      mockPasskeyHookValue = {
        ...defaultPasskeyHook,
        passkeys: [
          {
            id: "passkey-1",
            friendlyName: "MacBook Pro",
            deviceType: "platform",
            createdAt: "2024-01-15T10:00:00Z",
            lastUsedAt: "2024-01-15T10:00:00Z",
          },
        ],
      };
      const user = userEvent.setup();
      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Remove" }));
      await user.click(screen.getByRole("button", { name: "Confirm" }));

      expect(mockDeletePasskey).toHaveBeenCalledWith("passkey-1");
    });
  });

  describe("sign out functionality", () => {
    it("should show confirmation when sign out all is clicked", async () => {
      const user = userEvent.setup();

      render(<SecurityPage />);

      await user.click(screen.getByText("Sign out all devices"));

      expect(globalThis.confirm).toHaveBeenCalledWith(
        "Are you sure you want to sign out of all devices? You will need to sign in again.",
      );
    });

    it("should call logout when sign out all is confirmed", async () => {
      const user = userEvent.setup();

      render(<SecurityPage />);

      await user.click(screen.getByText("Sign out all devices"));

      expect(mockAuthContextValue.logout).toHaveBeenCalled();
    });

    it("should not logout when sign out all is cancelled", async () => {
      const user = userEvent.setup();
      (globalThis.confirm as jest.Mock).mockReturnValueOnce(false);

      render(<SecurityPage />);

      await user.click(screen.getByText("Sign out all devices"));

      expect(mockAuthContextValue.logout).not.toHaveBeenCalled();
    });

    it("should show confirmation when sign out current session is clicked", async () => {
      const user = userEvent.setup();

      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Sign Out" }));

      expect(globalThis.confirm).toHaveBeenCalledWith(
        "Are you sure you want to sign out of this device?",
      );
    });

    it("should call logout when sign out current session is confirmed", async () => {
      const user = userEvent.setup();

      render(<SecurityPage />);

      await user.click(screen.getByRole("button", { name: "Sign Out" }));

      expect(mockAuthContextValue.logout).toHaveBeenCalled();
    });
  });

  describe("button states", () => {
    it("should have disabled Generate button for recovery codes", () => {
      render(<SecurityPage />);

      const generateButton = screen.getByRole("button", { name: "Generate" });
      expect(generateButton).toBeDisabled();
    });

    it("should have enabled Set Up button for authenticator", () => {
      render(<SecurityPage />);

      const setupButton = screen.getByRole("button", { name: "Set Up" });
      expect(setupButton).not.toBeDisabled();
    });

    it("should have enabled Change button for password", () => {
      render(<SecurityPage />);

      const changeButton = screen.getByRole("button", { name: "Change" });
      expect(changeButton).not.toBeDisabled();
    });
  });

  describe("error display", () => {
    it("should display passkey error when present", () => {
      mockPasskeyHookValue = {
        ...defaultPasskeyHook,
        error: "Failed to register passkey",
      };
      render(<SecurityPage />);

      expect(
        screen.getByText("Failed to register passkey"),
      ).toBeInTheDocument();
    });
  });
});
