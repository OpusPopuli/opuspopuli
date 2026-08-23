import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallAppButton } from "@/components/install/InstallAppButton";
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

describe("InstallAppButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    givenState();
  });

  it("opens the browser install dialog", async () => {
    render(<InstallAppButton />);

    await userEvent.click(screen.getByRole("button", { name: "Install app" }));

    expect(install).toHaveBeenCalledTimes(1);
  });

  it("stays available after the banner was dismissed", () => {
    givenState({ isDismissed: true });
    render(<InstallAppButton />);

    expect(
      screen.getByRole("button", { name: "Install app" }),
    ).toBeInTheDocument();
  });

  it("toggles the Share-sheet steps on iOS", async () => {
    givenState({ method: "ios-share" });
    render(<InstallAppButton />);
    const button = screen.getByRole("button", { name: "Install app" });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute(
      "aria-controls",
      screen.getByRole("list").id,
    );
    expect(install).not.toHaveBeenCalled();

    await userEvent.click(button);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders nothing when the app cannot be installed", () => {
    givenState({ isInstallable: false, method: null });
    const { container } = render(<InstallAppButton />);

    expect(container).toBeEmptyDOMElement();
  });
});
