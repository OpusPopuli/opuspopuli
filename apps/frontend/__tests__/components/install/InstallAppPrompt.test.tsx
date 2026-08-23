import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallAppPrompt } from "@/components/install/InstallAppPrompt";
import type { InstallPrompt } from "@/lib/hooks/useInstallPrompt";

const install = jest.fn().mockResolvedValue("accepted");
const dismiss = jest.fn();
let state: InstallPrompt;

jest.mock("@/lib/hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => state,
}));

function givenState(overrides: Partial<InstallPrompt> = {}) {
  state = {
    isInstallable: true,
    isDismissed: false,
    method: "native",
    install,
    dismiss,
    ...overrides,
  };
}

describe("InstallAppPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    givenState();
  });

  it("offers an install button when the browser can install the app", async () => {
    render(<InstallAppPrompt />);

    await userEvent.click(screen.getByRole("button", { name: "Install app" }));

    expect(install).toHaveBeenCalledTimes(1);
  });

  it("is labelled for screen readers", () => {
    render(<InstallAppPrompt />);

    expect(
      screen.getByRole("complementary", {
        name: "Add OPUS to your home screen",
      }),
    ).toBeInTheDocument();
  });

  it("dismisses from the close button", async () => {
    render(<InstallAppPrompt />);

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss the install prompt" }),
    );

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses from 'Not now'", async () => {
    render(<InstallAppPrompt />);

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("shows Share-sheet steps instead of a button on iOS", () => {
    givenState({ method: "ios-share" });
    render(<InstallAppPrompt />);

    expect(
      screen.queryByRole("button", { name: "Install app" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(
      screen.getByText(/Add to Home Screen/, { selector: "li" }),
    ).toBeInTheDocument();
  });

  it("renders nothing when the app cannot be installed", () => {
    givenState({ isInstallable: false, method: null });
    const { container } = render(<InstallAppPrompt />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once dismissed", () => {
    givenState({ isDismissed: true });
    const { container } = render(<InstallAppPrompt />);

    expect(container).toBeEmptyDOMElement();
  });
});
