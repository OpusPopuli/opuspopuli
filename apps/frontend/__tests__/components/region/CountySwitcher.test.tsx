import { readFileSync } from "fs";
import { join } from "path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CountySwitcher } from "@/components/region/CountySwitcher";
import type { CountyThreshold } from "@/lib/graphql/counties";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("next/link", () => {
  // Spread the rest: the component sets aria-current on the row being read,
  // and a mock that drops unknown props hides that from the test.
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

/**
 * Alphabetical order and threshold order are deliberately opposite here:
 * Alpine is alphabetically first and has the smallest threshold, Yolo is
 * last and the largest. Any ordering that leaked signaturesRequired in
 * would be invisible with a fixture where the two agree.
 */
type Fixture = Pick<CountyThreshold, "fips" | "name" | "signaturesRequired">;

const COUNTIES: Fixture[] = [
  { fips: "06097", name: "Sonoma County", signaturesRequired: 40120 },
  { fips: "06003", name: "Alpine County", signaturesRequired: 62 },
  { fips: "06113", name: "Yolo County", signaturesRequired: 238923 },
  { fips: "06055", name: "Napa County", signaturesRequired: 9000 },
];

const HOME = "06097";

describe("CountySwitcher", () => {
  it("keeps the Home badge on the control at home (AC1)", () => {
    render(
      <CountySwitcher
        counties={COUNTIES as CountyThreshold[]}
        homeFips={HOME}
        selectedFips={HOME}
      />,
    );
    expect(screen.getByText("switcher.home")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Sonoma County");
  });

  it("still marks home in the list while visiting elsewhere (AC1)", async () => {
    render(
      <CountySwitcher
        counties={COUNTIES as CountyThreshold[]}
        homeFips={HOME}
        selectedFips="06055"
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Napa County");
    await userEvent.click(screen.getByRole("button"));
    const home = screen.getByRole("link", { name: /Sonoma County/ });
    expect(within(home).getByText("switcher.home")).toBeInTheDocument();
  });

  it("pins home first, then orders alphabetically — never by threshold (AC3)", async () => {
    render(
      <CountySwitcher
        counties={COUNTIES as CountyThreshold[]}
        homeFips={HOME}
        selectedFips={HOME}
      />,
    );
    await userEvent.click(screen.getByRole("button"));
    const names = screen.getAllByRole("link").map((l) => l.textContent ?? "");
    expect(names[0]).toContain("Sonoma County");
    expect(
      names.slice(1).map((n) => n.replace("switcher.home", "").trim()),
    ).toEqual(["Alpine County", "Napa County", "Yolo County"]);
    // Cheapest-first would have put Alpine (62) ahead of Napa (9,000) ahead
    // of Sonoma (40,120) ahead of Yolo — which is the same as alphabetical
    // for these three, so the source guard below is what actually holds.
  });

  it("has no sort-by-threshold code path at all (AC3)", () => {
    // A source-level guard, matching the link-prefetch precedent: ordering
    // 58 counties by fewest signatures is the "cheapest county" reading
    // with a UI around it, which #1105's framing constraint forbids. A
    // render assertion cannot prove the absence of a comparator; reading
    // the file can.
    // Relative, matching link-prefetch.test.tsx — the precedent this guard
    // is modelled on — rather than process.cwd().
    const source = readFileSync(
      join("components", "region", "CountySwitcher.tsx"),
      "utf8",
    );
    const sortBody = source.slice(source.indexOf(".sort("));
    expect(sortBody).not.toMatch(/signaturesRequired|shareOfRegistered|rank/);
  });

  it("links carry the fips of the county being read", async () => {
    render(
      <CountySwitcher
        counties={COUNTIES as CountyThreshold[]}
        homeFips={HOME}
        selectedFips={HOME}
      />,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("link", { name: /Alpine County/ })).toHaveAttribute(
      "href",
      "/region/county?fips=06003",
    );
  });

  it("marks the county currently being read", async () => {
    render(
      <CountySwitcher
        counties={COUNTIES as CountyThreshold[]}
        homeFips={HOME}
        selectedFips="06055"
      />,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("link", { name: /Napa County/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
