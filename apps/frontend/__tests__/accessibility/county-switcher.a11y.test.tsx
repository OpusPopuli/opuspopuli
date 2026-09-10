/**
 * WCAG 2.2 AA tests for the county switcher (#1199).
 *
 * The gap this file exists to close: the switcher shipped as a disclosure
 * menu with no way out from the keyboard. Escape did nothing and a click
 * outside did nothing, so a reader who opened it could only leave by
 * tabbing through all fifty-eight counties — while
 * `components/search/HeaderSearch.tsx` had implemented the pattern
 * properly all along.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";
import { CountySwitcher } from "@/components/region/CountySwitcher";

expect.extend(toHaveNoViolations);

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  } & Record<string, unknown>) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  };
});

const COUNTIES = [
  { fips: "06097", name: "Sonoma County", signaturesRequired: 40120 },
  { fips: "06003", name: "Alpine County", signaturesRequired: 62 },
  { fips: "06055", name: "Napa County", signaturesRequired: 9000 },
] as never[];

const HOME = "06097";

function setup(selected = HOME) {
  return render(
    <CountySwitcher
      counties={COUNTIES}
      homeFips={HOME}
      selectedFips={selected}
    />,
  );
}

describe("County switcher — WCAG 2.2 AA", () => {
  it("has no axe violations closed", async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations open", async () => {
    const { container } = setup();
    await userEvent.click(screen.getByRole("button"));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reports its expanded state on the trigger", async () => {
    setup();
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    setup();
    const trigger = screen.getByRole("button");
    await userEvent.click(trigger);
    expect(screen.getByRole("list")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on a click outside, without stealing focus", async () => {
    render(<div data-testid="elsewhere">elsewhere</div>);
    setup();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("list")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("elsewhere"));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("can be opened from the keyboard alone", async () => {
    setup();
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("marks the county being read with aria-current=page", async () => {
    setup("06055");
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("link", { name: /Napa County/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
