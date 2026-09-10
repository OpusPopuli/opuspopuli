import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useQuery } from "@apollo/client/react";
import RegionPage from "@/app/region/page";
import {
  GET_BILLS,
  MY_COUNTY_SUPERVISORS,
  MY_JURISDICTIONS,
} from "@/lib/graphql/region";

jest.mock("@apollo/client/react", () => ({ useQuery: jest.fn() }));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  };
});

const mockUseQuery = useQuery as jest.Mock;

const CALIFORNIA = {
  id: "ca",
  name: "California",
  type: "STATE",
  level: "STATE",
};

function jurisdiction(
  type: string,
  name: string,
  level: string,
  parent?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    resolvedBy: "address",
    resolvedAt: "2026-09-01T00:00:00Z",
    jurisdiction: { id: type, name, type, level, stateCode: "CA", parent },
  };
}

/**
 * Production shape, verified against the running stack: user_jurisdictions
 * never carries a STATE row — resolution is point-in-polygon and no
 * statewide boundary is loaded — only districts whose parent is the state.
 */
const FULL_STACK = [
  jurisdiction("COUNTY", "Sonoma County", "COUNTY"),
  jurisdiction("CONGRESSIONAL_DISTRICT", "CA-04", "FEDERAL"),
  jurisdiction(
    "STATE_ASSEMBLY_DISTRICT",
    "Assembly District 10",
    "STATE",
    CALIFORNIA,
  ),
  jurisdiction(
    "STATE_SENATE_DISTRICT",
    "Senate District 02",
    "STATE",
    CALIFORNIA,
  ),
];

const HOPKINS = {
  id: "sup-5",
  name: "Lynda Hopkins",
  chamber: "BOARD",
  district: "5",
  party: null,
  photoUrl: null,
};

/** Dates the count probe should accept / reject, relative to a fixed now. */
const NOW = Date.parse("2026-09-09T12:00:00Z");
const TWO_DAYS_AGO = "2026-09-07T12:00:00Z";
const THIRTY_DAYS_AGO = "2026-08-10T12:00:00Z";

interface Options {
  jurisdictions?: unknown[];
  supervisors?: unknown[];
  billDates?: (string | null)[];
  billError?: boolean;
  jurisdictionsLoading?: boolean;
  jurisdictionsError?: boolean;
}

function setup(options: Options = {}) {
  const {
    jurisdictions = FULL_STACK,
    supervisors = [HOPKINS],
    billDates = [TWO_DAYS_AGO],
    billError = false,
    jurisdictionsLoading = false,
    jurisdictionsError = false,
  } = options;

  mockUseQuery.mockImplementation((document: unknown) => {
    if (document === MY_JURISDICTIONS) {
      return {
        data: jurisdictionsLoading
          ? undefined
          : { myJurisdictions: jurisdictions },
        loading: jurisdictionsLoading,
        error: jurisdictionsError ? new Error("boom") : null,
      };
    }
    if (document === MY_COUNTY_SUPERVISORS) {
      return {
        data: { myCountySupervisors: supervisors },
        loading: false,
        error: null,
      };
    }
    if (document === GET_BILLS) {
      return {
        data: billError
          ? undefined
          : {
              bills: {
                items: billDates.map((lastActionDate, i) => ({
                  id: `bill-${i}`,
                  lastActionDate,
                })),
                total: billDates.length,
                hasMore: false,
              },
            },
        loading: false,
        error: billError ? new Error("search down") : null,
      };
    }
    return { data: undefined, loading: false, error: null };
  });
}

describe("RegionPage — the jurisdiction stack (#1194)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    setup();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the three governments smallest first", () => {
    render(<RegionPage />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/region/county");
    expect(hrefs).toContain("/region/state");
    expect(hrefs).toContain("/region/federal");
    // County before state before federal — the ordering is the design.
    expect(hrefs.indexOf("/region/county")).toBeLessThan(
      hrefs.indexOf("/region/state"),
    );
    expect(hrefs.indexOf("/region/state")).toBeLessThan(
      hrefs.indexOf("/region/federal"),
    );
  });

  it("does not render a city layer", () => {
    render(<RegionPage />);
    expect(
      screen.getAllByRole("link").map((l) => l.getAttribute("href")),
    ).not.toContain("/region/city");
  });

  it("shows the reader's seat when exactly one supervisor resolves", () => {
    render(<RegionPage />);
    expect(screen.getByText(/stack.county.yourSeat/)).toBeInTheDocument();
    expect(screen.getByText(/Lynda Hopkins/)).toBeInTheDocument();
  });

  it("omits the seat line when the district did not resolve (#1136)", () => {
    // 57 of 58 counties have no supervisorial boundary, so the server
    // returns the whole board. Naming one of five as "yours" would be a
    // guess, and a wrong-supervisor claim is worse than no claim.
    setup({
      supervisors: [HOPKINS, { ...HOPKINS, id: "sup-1", district: "1" }],
    });
    render(<RegionPage />);
    expect(screen.queryByText(/stack.county.yourSeat/)).not.toBeInTheDocument();
  });

  it("counts only bills inside the trailing window", () => {
    setup({ billDates: [TWO_DAYS_AGO, THIRTY_DAYS_AGO, null] });
    render(<RegionPage />);
    expect(
      screen.getByText(/stack.count.thisWeek.*"value":"1"/),
    ).toBeInTheDocument();
  });

  it("marks a saturated probe page as capped", () => {
    setup({ billDates: new Array(25).fill(TWO_DAYS_AGO) });
    render(<RegionPage />);
    expect(screen.getByText(/"value":"25\+"/)).toBeInTheDocument();
  });

  it("renders 'not counted yet' — never zero — where we cannot count", () => {
    // County meetings carry no jurisdiction (#1139) and there is no federal
    // corpus. "We did not look" and "nothing happened" are different claims.
    render(<RegionPage />);
    expect(screen.getAllByText("stack.count.unavailable")).toHaveLength(2);
  });

  it("treats a failed bill probe as uncounted, not as zero", () => {
    setup({ billError: true });
    render(<RegionPage />);
    expect(screen.getAllByText("stack.count.unavailable")).toHaveLength(3);
    expect(screen.queryByText(/"value":"0"/)).not.toBeInTheDocument();
  });

  it("renders zero as a real answer when the window is genuinely empty", () => {
    setup({ billDates: [THIRTY_DAYS_AGO] });
    render(<RegionPage />);
    expect(screen.getByText(/"value":"0"/)).toBeInTheDocument();
  });

  it("prompts for an address when nothing resolved", () => {
    setup({ jurisdictions: [] });
    render(<RegionPage />);
    expect(screen.getByText("stack.noAddress.title")).toBeInTheDocument();
  });

  it("shows a skeleton while jurisdictions load", () => {
    setup({ jurisdictionsLoading: true });
    const { container } = render(<RegionPage />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows an error state when jurisdictions fail", () => {
    setup({ jurisdictionsError: true });
    render(<RegionPage />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the county's gold rule redundant with a text label", () => {
    render(<RegionPage />);
    // WCAG 1.4.1 — the rule must never be the only carrier.
    const county = screen.getByText("Sonoma County").closest("a");
    expect(
      within(county as HTMLElement).getByText("stack.levels.county"),
    ).toBeInTheDocument();
  });

  it("derives the state card from a district's parent (no STATE row exists)", () => {
    // Regression: reading `type === "STATE"` found nothing in production and
    // silently dropped the card holding nearly all of today's data.
    render(<RegionPage />);
    expect(screen.getByText("California")).toBeInTheDocument();
  });

  it("still uses a real STATE row when one resolves", () => {
    setup({
      jurisdictions: [
        ...FULL_STACK,
        jurisdiction("STATE", "California", "STATE"),
      ],
    });
    render(<RegionPage />);
    expect(screen.getAllByText("California")).toHaveLength(1);
  });

  it("never claims a board size from the district-filtered supervisor list", () => {
    // myCountySupervisors returns ONE supervisor when the seat resolves
    // (#1136), so its length is not the size of the board. "1 seat" for a
    // five-seat board is worse than saying nothing.
    render(<RegionPage />);
    expect(screen.getByText("stack.county.board")).toBeInTheDocument();
    expect(screen.queryByText(/"count":1/)).not.toBeInTheDocument();
  });
});
