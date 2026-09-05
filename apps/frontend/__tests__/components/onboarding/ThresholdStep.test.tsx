import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ThresholdStep } from "@/components/onboarding/steps/ThresholdStep";
import type { CivicResolutionStatus } from "@/lib/graphql/profile";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars
        ? `${key}(${Object.entries(vars)
            .map(([k, v]) => `${k}=${v}`)
            .join(",")})`
        : key,
    i18n: { language: "en" },
  }),
}));

// The ledger is the landing page's, and has its own spec. Stand in for it so
// this one is about which county the step resolves to, not how it is drawn.
jest.mock("@/components/landing/CountyRail", () => ({
  CountyRail: ({ county }: { county: { name: string } }) => (
    <aside data-testid="rail">{county.name}</aside>
  ),
}));

const SONOMA = {
  fips: "06097",
  name: "Sonoma County",
  gubernatorialVotes: 197454,
  gubernatorialYear: 2022,
  registeredVoters: 314218,
  population: 485375,
  signaturesRequired: 19746,
  shareOfRegistered: 0.0628,
  rank: 45,
  cheapestNeighbor: null,
  sourceUrl: "https://example.invalid/sov.xlsx",
  retrievedAt: "2026-09-04T00:00:00.000Z",
};

let addressData: unknown = undefined;

jest.mock("@apollo/client/react", () => ({
  useQuery: (doc: unknown) =>
    doc === jest.requireActual("@/lib/graphql/counties").GET_COUNTY_THRESHOLDS
      ? { data: { countyThresholds: [SONOMA] } }
      : { data: addressData },
}));

const address = (
  county: string | undefined,
  civicResolutionStatus: CivicResolutionStatus = "resolved",
) => ({
  myAddresses: [
    {
      id: "a1",
      addressType: "RESIDENTIAL",
      isPrimary: true,
      county,
      civicResolutionStatus,
    },
  ],
});

const noop = () => {};

beforeEach(() => {
  addressData = undefined;
});

describe("ThresholdStep", () => {
  it("matches the geocoder's bare county name to the published one", () => {
    // The Census writes "Sonoma"; the region service publishes "Sonoma
    // County". A raw comparison fails for all 58, silently.
    addressData = address("Sonoma");
    render(<ThresholdStep onComplete={noop} onCorrect={noop} />);
    expect(screen.getByTestId("rail")).toHaveTextContent("Sonoma County");
  });

  it("names the reader's own county in the claim", () => {
    addressData = address("Sonoma County");
    render(<ThresholdStep onComplete={noop} onCorrect={noop} />);
    expect(
      screen.getByRole("heading", { name: /county=Sonoma County/ }),
    ).toBeInTheDocument();
  });

  it("asks for an address rather than offering to correct a county it never named", () => {
    addressData = { myAddresses: [] };
    render(<ThresholdStep onComplete={noop} onCorrect={noop} />);
    expect(
      screen.getByRole("button", { name: "threshold.addAddress" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "threshold.wrongCounty" }),
    ).toBeNull();
  });

  it("says it is still working while the geocoder is", () => {
    addressData = address(undefined, "pending");
    render(<ThresholdStep onComplete={noop} onCorrect={noop} />);
    expect(screen.getByText("threshold.waitingBody")).toBeInTheDocument();
  });

  it("distinguishes no address from no match", () => {
    // Telling someone who skipped the form that we are "still loading" is a
    // lie, and telling someone mid-geocode that we have no data is another.
    addressData = { myAddresses: [] };
    const { unmount } = render(
      <ThresholdStep onComplete={noop} onCorrect={noop} />,
    );
    expect(screen.getByText("threshold.noAddressBody")).toBeInTheDocument();
    unmount();

    addressData = address("Multnomah");
    render(<ThresholdStep onComplete={noop} onCorrect={noop} />);
    expect(screen.getByText("threshold.noMatchBody")).toBeInTheDocument();
  });

  it("never shows a county the address did not resolve to", () => {
    addressData = address("Multnomah");
    render(<ThresholdStep onComplete={noop} onCorrect={noop} />);
    expect(screen.queryByTestId("rail")).toBeNull();
  });

  it("offers a one-click correction when the county is wrong", async () => {
    const onCorrect = jest.fn();
    addressData = address("Sonoma");
    const user = userEvent.setup();
    render(<ThresholdStep onComplete={noop} onCorrect={onCorrect} />);

    await user.click(
      screen.getByRole("button", { name: "threshold.wrongCounty" }),
    );
    expect(onCorrect).toHaveBeenCalled();
  });

  it("advances on continue", async () => {
    const onComplete = jest.fn();
    addressData = address("Sonoma");
    const user = userEvent.setup();
    render(<ThresholdStep onComplete={onComplete} onCorrect={noop} />);

    await user.click(screen.getByRole("button", { name: "continue" }));
    expect(onComplete).toHaveBeenCalled();
  });
});
