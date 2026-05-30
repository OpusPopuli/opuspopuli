import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { LanguageToggle } from "@/components/LanguageToggle";

const mockSetLocale = jest.fn();
let mockLocale: "en" | "es" = "en";

jest.mock("@/lib/i18n/context", () => ({
  useLocale: () => ({ locale: mockLocale, setLocale: mockSetLocale }),
}));

const mockShowToast = jest.fn();
jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

let mockIsAuthenticated = false;
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

// The mutation tuple swapped per test via assignment so each case can
// inspect whether the persist call fired or not.
let mockUpdate = jest.fn().mockResolvedValue({ data: {} });
jest.mock("@apollo/client/react", () => ({
  useMutation: () => [mockUpdate, { loading: false }],
}));

describe("LanguageToggle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocale = "en";
    mockIsAuthenticated = false;
    mockUpdate = jest.fn().mockResolvedValue({ data: {} });
  });

  it("renders both language options as a radio group", () => {
    render(<LanguageToggle />);
    expect(screen.getByRole("radio", { name: "EN" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "ES" })).not.toBeChecked();
  });

  it("flips the locale on selection", async () => {
    render(<LanguageToggle />);
    await userEvent.click(screen.getByRole("radio", { name: "ES" }));
    expect(mockSetLocale).toHaveBeenCalledWith("es");
  });

  it("does NOT call updateProfile when unauthenticated", async () => {
    mockIsAuthenticated = false;
    render(<LanguageToggle />);
    await userEvent.click(screen.getByRole("radio", { name: "ES" }));
    expect(mockSetLocale).toHaveBeenCalledWith("es");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("persists via updateProfile when authenticated", async () => {
    mockIsAuthenticated = true;
    render(<LanguageToggle />);
    await userEvent.click(screen.getByRole("radio", { name: "ES" }));
    expect(mockUpdate).toHaveBeenCalledWith({
      variables: { input: { preferredLanguage: "es" } },
    });
  });

  it("shows a toast and warns when persistence fails", async () => {
    mockIsAuthenticated = true;
    mockUpdate = jest.fn().mockRejectedValue(new Error("network"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    render(<LanguageToggle />);
    await userEvent.click(screen.getByRole("radio", { name: "ES" }));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        "errors.preferencesNotSaved",
        "warning",
      );
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op when the active locale is reselected", async () => {
    mockIsAuthenticated = true;
    mockLocale = "en";
    render(<LanguageToggle />);
    // Clicking the already-active radio shouldn't fire any state changes
    // or mutations. This guards against re-render churn and an
    // unnecessary network call.
    await userEvent.click(screen.getByRole("radio", { name: "EN" }));
    expect(mockSetLocale).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
