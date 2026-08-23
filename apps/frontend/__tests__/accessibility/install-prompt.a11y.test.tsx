/**
 * WCAG 2.2 AA accessibility tests for the PWA install affordances.
 *
 * Both the passive banner and the menu button are new interactive surfaces
 * that appear over the app chrome, so they are scanned in each of their
 * platform states (native install dialog vs. the iOS Share recipe).
 */

import { fireEvent, render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import { InstallAppPrompt } from "@/components/install/InstallAppPrompt";
import { InstallAppButton } from "@/components/install/InstallAppButton";
import type { InstallPrompt } from "@/lib/hooks/useInstallPrompt";

expect.extend(toHaveNoViolations);

let state: InstallPrompt;

jest.mock("@/lib/hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => state,
}));

function givenState(overrides: Partial<InstallPrompt> = {}) {
  state = {
    isInstallable: true,
    isDismissed: false,
    method: "native",
    install: jest.fn().mockResolvedValue("accepted"),
    dismiss: jest.fn(),
    ...overrides,
  };
}

describe("Install affordances — WCAG 2.2 AA", () => {
  beforeEach(() => givenState());

  it("banner has no axe violations with a native install button", async () => {
    const { container } = render(<InstallAppPrompt />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("banner has no axe violations showing the iOS Share steps", async () => {
    givenState({ method: "ios-share" });
    const { container } = render(<InstallAppPrompt />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("menu button has no axe violations, collapsed or expanded", async () => {
    givenState({ method: "ios-share" });
    const { container, getByRole } = render(<InstallAppButton />);
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(getByRole("button", { name: /install app/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
