import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CountyThreshold } from "@/lib/graphql/counties";
import { CountyHero } from "@/components/landing/CountyHero";

let authed = false;
let authLoading = false;
let reducedMotion = false;
let queryResult: { data?: unknown; error?: Error } = {};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

jest.mock("@apollo/client/react", () => ({
  useQuery: () => queryResult,
}));

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: authed, isLoading: authLoading }),
}));

jest.mock("@/lib/hooks", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

// `next/dynamic` defers the map behind a promise, so under jest the hero would
// render only its skeleton and never the stand-in below. Resolve the loader
// eagerly; the ssr:false behaviour it models is a browser concern, not
// something this spec is asserting.
jest.mock("next/dynamic", () => () => {
  const { CountyMap } = jest.requireMock("@/components/landing/CountyMap");
  return CountyMap;
});

// The real map needs MapLibre and a WebGL context. Stand in for it with the
// two things the hero actually drives: which county is highlighted, and the
// callbacks that change it.
jest.mock("@/components/landing/CountyMap", () => ({
  CountyMap: ({
    selectedFips,
    onSelect,
    onHover,
  }: {
    selectedFips: string;
    onSelect: (f: string) => void;
    onHover: (f: string | null) => void;
  }) => (
    <div>
      <span data-testid="highlighted">{selectedFips}</span>
      <button type="button" onClick={() => onSelect("06075")}>
        click sf
      </button>
      <button type="button" onClick={() => onHover("06001")}>
        hover alameda
      </button>
      <button type="button" onClick={() => onHover(null)}>
        leave
      </button>
    </div>
  ),
}));

function county(fips: string, name: string): CountyThreshold {
  return {
    fips,
    name,
    gubernatorialVotes: 1000,
    gubernatorialYear: 2022,
    registeredVoters: 2000,
    population: 3000,
    signaturesRequired: 100,
    shareOfRegistered: 0.05,
    rank: 1,
    cheapestNeighbor: null,
    sourceUrl: "https://example.invalid/sov.xlsx",
    retrievedAt: "2026-09-03T00:00:00.000Z",
  };
}

const COUNTIES = [
  county("06097", "Sonoma County"),
  county("06075", "San Francisco County"),
  county("06001", "Alameda County"),
];

beforeEach(() => {
  authed = false;
  authLoading = false;
  reducedMotion = false;
  queryResult = { data: { countyThresholds: COUNTIES } };
});

describe("CountyHero", () => {
  it("opens on Sonoma, where this was built", () => {
    render(<CountyHero />);
    expect(screen.getByTestId("highlighted")).toHaveTextContent("06097");
    expect(screen.getByRole("complementary")).toHaveAccessibleName(
      "Sonoma County",
    );
  });

  it("keeps the headline and the way in when the query fails", () => {
    // The region service being down must not cost the page its headline or its
    // only sign-up link. An empty map would read as "no counties qualify", so
    // that half is dropped instead.
    queryResult = { error: new Error("boom") };
    render(<CountyHero />);

    expect(
      screen.getByRole("heading", { level: 1, name: "counties.heading" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "counties.cta.start" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("highlighted")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("drops the map and ledger while the counties are still loading", () => {
    queryResult = {};
    render(<CountyHero />);

    expect(
      screen.getByRole("heading", { level: 1, name: "counties.heading" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("highlighted")).toBeNull();
  });

  it("sends a signed-out reader to register, with sign-in alongside", () => {
    render(<CountyHero />);
    expect(
      screen.getByRole("link", { name: "counties.cta.start" }),
    ).toHaveAttribute("href", "/register");
    expect(
      screen.getByRole("link", { name: "counties.cta.signIn" }),
    ).toHaveAttribute("href", "/login");
  });

  it("shows neither call to action until the session resolves", () => {
    // isAuthenticated is false while the session loads, so rendering straight
    // through would offer a signed-in reader an account and then swap it.
    authLoading = true;
    render(<CountyHero />);
    expect(
      screen.queryByRole("link", { name: "counties.cta.start" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "counties.cta.briefing" }),
    ).toBeNull();
  });

  it("sends a signed-in reader to their briefing instead", () => {
    authed = true;
    render(<CountyHero />);
    expect(
      screen.getByRole("link", { name: "counties.cta.briefing" }),
    ).toHaveAttribute("href", "/me/briefing");
    expect(
      screen.queryByRole("link", { name: "counties.cta.start" }),
    ).toBeNull();
  });

  describe("the tour", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const advance = (ms: number) =>
      act(() => {
        jest.advanceTimersByTime(ms);
      });

    it("moves to another county on its own", () => {
      // The route is rotated to open on the county already shown, so the first
      // hop is always somewhere new. Without that this assertion would flake
      // whenever the shuffle put Sonoma second.
      render(<CountyHero />);
      advance(5000);
      expect(screen.getByTestId("highlighted")).not.toHaveTextContent("06097");
    });

    it("never re-shows the county it just left", () => {
      render(<CountyHero />);
      const seen = new Set<string>();
      for (let i = 0; i < COUNTIES.length; i++) {
        advance(5000);
        seen.add(screen.getByTestId("highlighted").textContent ?? "");
      }
      // A full lap covers every county exactly once, including the one it
      // started on, which is what makes the cycle a tour and not a shuffle.
      expect(seen.size).toBe(COUNTIES.length);
    });

    it("does not tour while the session is still resolving", () => {
      authLoading = true;
      render(<CountyHero />);
      const before = screen.getByTestId("highlighted").textContent;
      advance(20000);
      expect(screen.getByTestId("highlighted").textContent).toBe(before);
    });

    it("never tours for a signed-in reader, who has a county of their own", () => {
      authed = true;
      render(<CountyHero />);
      const before = screen.getByTestId("highlighted").textContent;
      advance(20000);
      expect(screen.getByTestId("highlighted").textContent).toBe(before);
    });

    it("does not tour under prefers-reduced-motion", () => {
      reducedMotion = true;
      render(<CountyHero />);
      const before = screen.getByTestId("highlighted").textContent;
      advance(20000);
      expect(screen.getByTestId("highlighted").textContent).toBe(before);
    });

    it("stops for good once the reader picks a county", async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<CountyHero />);

      await user.click(screen.getByRole("button", { name: "click sf" }));
      expect(screen.getByTestId("highlighted")).toHaveTextContent("06075");

      advance(20000);
      expect(screen.getByTestId("highlighted")).toHaveTextContent("06075");
    });

    it("previews the hovered county without losing the chosen one", async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<CountyHero />);

      await user.click(screen.getByRole("button", { name: "click sf" }));
      await user.click(screen.getByRole("button", { name: "hover alameda" }));
      expect(screen.getByRole("complementary")).toHaveAccessibleName(
        "Alameda County",
      );

      await user.click(screen.getByRole("button", { name: "leave" }));
      expect(screen.getByRole("complementary")).toHaveAccessibleName(
        "San Francisco County",
      );
    });

    it("holds still while the pointer is over the map", async () => {
      // Nothing should move the figure out from under someone reading it.
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<CountyHero />);

      await user.click(screen.getByRole("button", { name: "hover alameda" }));
      advance(20000);
      expect(screen.getByRole("complementary")).toHaveAccessibleName(
        "Alameda County",
      );
    });
  });
});
