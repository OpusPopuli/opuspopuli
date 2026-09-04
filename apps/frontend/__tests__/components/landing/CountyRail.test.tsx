import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountyRail } from "@/components/landing/CountyRail";
import type { CountyThreshold } from "@/lib/graphql/counties";

let language = "en";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Echo the key plus interpolations so assertions test wiring, not copy.
    t: (key: string, vars?: Record<string, unknown>) =>
      vars
        ? `${key}(${Object.entries(vars)
            .map(([k, v]) => `${k}=${v}`)
            .join(",")})`
        : key,
    i18n: { language },
  }),
}));

const NEVADA: CountyThreshold = {
  fips: "06057",
  name: "Nevada County",
  gubernatorialVotes: 50737,
  gubernatorialYear: 2022,
  registeredVoters: 76423,
  population: 102241,
  signaturesRequired: 5074,
  shareOfRegistered: 5074 / 76423,
  rank: 12,
  cheapestNeighbor: {
    fips: "06091",
    name: "Sierra County",
    signaturesRequired: 200,
  },
  sourceUrl:
    "https://elections.cdn.sos.ca.gov/sov/2022-general/sov/19-governor.xlsx",
  retrievedAt: "2026-09-03T23:22:47.923Z",
};

describe("CountyRail", () => {
  it("renders every figure the map encodes, as a number", () => {
    // WCAG 1.4.1: a value carried only by hue is unreadable to a colour-blind
    // reader and invisible to a screen reader. The rail is what makes the
    // map's information actually available.
    render(<CountyRail county={NEVADA} />);

    expect(screen.getByText("5,074")).toBeInTheDocument(); // signatures
    expect(screen.getByText("50,737")).toBeInTheDocument(); // votes
    expect(screen.getByText("76,423")).toBeInTheDocument(); // registered
    expect(screen.getByText("102,241")).toBeInTheDocument(); // population
    expect(screen.getByText("6.64%")).toBeInTheDocument(); // share
    expect(
      screen.getByText(/counties\.rail\.rankValue\(rank=12\)/),
    ).toBeInTheDocument();
  });

  it("labels the region with the county name", () => {
    render(<CountyRail county={NEVADA} />);
    expect(
      screen.getByRole("complementary", { name: "Nevada County" }),
    ).toBeInTheDocument();
  });

  it("links the source record so the figure can be checked", () => {
    render(<CountyRail county={NEVADA} />);

    const link = screen.getByRole("link", { name: "counties.rail.sources" });
    expect(link).toHaveAttribute("href", NEVADA.sourceUrl);
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("makes the cheapest neighbour selectable", async () => {
    const onSelectFips = jest.fn();
    render(<CountyRail county={NEVADA} onSelectFips={onSelectFips} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Sierra County/ }),
    );

    expect(onSelectFips).toHaveBeenCalledWith("06091");
  });

  it("renders the neighbour as text when selection is not wired", () => {
    render(<CountyRail county={NEVADA} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Sierra County/)).toBeInTheDocument();
  });

  it("says a figure is unavailable rather than printing a wrong one", () => {
    // null registration must not become "0" or a division that invents a share.
    render(
      <CountyRail
        county={{
          ...NEVADA,
          registeredVoters: null,
          shareOfRegistered: null,
          population: null,
        }}
      />,
    );

    expect(screen.getAllByText("counties.rail.unknown")).toHaveLength(3);
  });
});

describe("CountyRail — locale", () => {
  afterEach(() => {
    language = "en";
  });

  it("formats numbers for the active locale, not the server's", () => {
    language = "es";
    render(<CountyRail county={NEVADA} />);

    // es-ES groups with a period: 50.737 rather than 50,737.
    expect(screen.getByText("50.737")).toBeInTheDocument();
  });
});
