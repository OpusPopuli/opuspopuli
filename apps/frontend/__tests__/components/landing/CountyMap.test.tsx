import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountyMap, rampPosition } from "@/components/landing/CountyMap";
import type { CountyThreshold } from "@/lib/graphql/counties";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${vars.name} — ${vars.count}` : key,
    i18n: { language: "en" },
  }),
}));

// deck.gl pulls in @mapbox/tiny-sdf, which ships ESM only and Jest cannot
// parse. Mocking the layer is also the right shape for this test: the contract
// under test is the props handed to deck.gl, not deck.gl's rendering.
jest.mock("@deck.gl/layers", () => ({
  GeoJsonLayer: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
}));

// The real component owns MapLibre + deck.gl; here we assert the props we hand
// it, not the pixels it draws.
const civicMapProps: Record<string, unknown>[] = [];
jest.mock("@/components/map/CivicMap", () => ({
  CivicMap: (props: Record<string, unknown>) => {
    civicMapProps.push(props);
    return (
      <div data-testid="civic-map" aria-label={props.ariaLabel as string} />
    );
  },
}));

const county = (
  fips: string,
  name: string,
  signaturesRequired: number,
  shareOfRegistered: number | null,
): CountyThreshold => ({
  fips,
  name,
  gubernatorialVotes: signaturesRequired * 10,
  gubernatorialYear: 2022,
  registeredVoters: 100000,
  population: null,
  signaturesRequired,
  shareOfRegistered,
  rank: 1,
  cheapestNeighbor: null,
  sourceUrl: "https://example.gov/sov.xlsx",
  retrievedAt: "2026-09-03T00:00:00Z",
});

const COUNTIES = [
  county("06003", "Alpine County", 62, 0.0328),
  county("06057", "Nevada County", 5074, 0.0664),
  county("06037", "Los Angeles County", 238923, 0.0698),
];

describe("rampPosition", () => {
  const bounds = { min: 62, max: 238923 };

  it("uses a log scale for people, so small counties are not flattened", () => {
    // Linear over four orders of magnitude puts Alpine and Nevada within 2% of
    // each other — 55 of 58 counties render as the same colour.
    const alpine = rampPosition(COUNTIES[0], "people", bounds)!;
    const nevada = rampPosition(COUNTIES[1], "people", bounds)!;
    const la = rampPosition(COUNTIES[2], "people", bounds)!;

    expect(alpine).toBeCloseTo(0, 2);
    expect(la).toBeCloseTo(1, 2);
    // The middle county lands mid-ramp rather than pinned near zero.
    expect(nevada).toBeGreaterThan(0.4);
    expect(nevada).toBeLessThan(0.8);
  });

  it("uses a linear scale for share, where the values sit in a narrow band", () => {
    const shareBounds = { min: 0.0328, max: 0.0698 };
    expect(rampPosition(COUNTIES[0], "share", shareBounds)).toBeCloseTo(0, 5);
    expect(rampPosition(COUNTIES[2], "share", shareBounds)).toBeCloseTo(1, 5);
  });

  it("returns null when the figure is unknown", () => {
    // Distinct from 0 — an unknown county must not render as "lowest".
    const unknown = county("06999", "Nowhere", 100, null);
    expect(rampPosition(unknown, "share", { min: 0, max: 1 })).toBeNull();
  });

  it("centres the ramp when every county is identical", () => {
    expect(rampPosition(COUNTIES[0], "people", { min: 62, max: 62 })).toBe(0.5);
  });
});

describe("CountyMap", () => {
  beforeEach(() => {
    civicMapProps.length = 0;
  });

  it("gives every county a focusable, labelled control", async () => {
    // The map is a canvas: its shapes are unreachable by keyboard and absent
    // from the accessibility tree. These buttons are the same information as
    // real controls (WCAG 2.1.1).
    render(
      <CountyMap
        counties={COUNTIES}
        mode="share"
        selectedFips={null}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Nevada County — 5,074" }),
    ).toBeInTheDocument();
  });

  it("selects a county from the keyboard", async () => {
    const onSelect = jest.fn();
    render(
      <CountyMap
        counties={COUNTIES}
        mode="share"
        selectedFips={null}
        onSelect={onSelect}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("06003");
  });

  it("marks the selected county as pressed", () => {
    render(
      <CountyMap
        counties={COUNTIES}
        mode="share"
        selectedFips="06057"
        onSelect={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Nevada County/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("suppresses the fill transition under prefers-reduced-motion", () => {
    render(
      <CountyMap
        counties={COUNTIES}
        mode="share"
        selectedFips={null}
        onSelect={jest.fn()}
        reducedMotion
      />,
    );

    const layer = (
      civicMapProps[0].layers as { props: Record<string, unknown> }[]
    )[0];
    expect(layer.props.transitions).toEqual({});
  });

  it("animates the fill when motion is not restricted", () => {
    render(
      <CountyMap
        counties={COUNTIES}
        mode="share"
        selectedFips={null}
        onSelect={jest.fn()}
      />,
    );

    const layer = (
      civicMapProps[0].layers as { props: Record<string, unknown> }[]
    )[0];
    expect(layer.props.transitions).toEqual({ getFillColor: 300 });
  });

  it("passes an accessible name through to the map", () => {
    render(
      <CountyMap
        counties={COUNTIES}
        mode="share"
        selectedFips={null}
        onSelect={jest.fn()}
      />,
    );

    expect(civicMapProps[0].ariaLabel).toBe("counties.heading");
  });
});
