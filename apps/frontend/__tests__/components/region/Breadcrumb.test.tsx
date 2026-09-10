import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { usePathname } from "next/navigation";
import { Breadcrumb } from "@/components/region/Breadcrumb";
import { RegionPageHeader } from "@/components/region/RegionPageHeader";

jest.mock("next/navigation", () => ({ usePathname: jest.fn() }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

const RESOLVED = [
  {
    resolvedBy: "address",
    resolvedAt: "2026-09-01T00:00:00Z",
    jurisdiction: {
      id: "c",
      name: "Sonoma County",
      type: "COUNTY",
      level: "COUNTY",
      stateCode: "CA",
    },
  },
  {
    resolvedBy: "address",
    resolvedAt: "2026-09-01T00:00:00Z",
    jurisdiction: {
      id: "a",
      name: "California State Assembly District 2",
      type: "STATE_ASSEMBLY_DISTRICT",
      level: "STATE",
      stateCode: "CA",
      parent: { id: "ca", name: "California", type: "STATE", level: "STATE" },
    },
  },
];

let mockJurisdictions: unknown[] = RESOLVED;
jest.mock("@/components/region/JurisdictionsContext", () => ({
  useJurisdictions: () => mockJurisdictions,
}));

const mockPathname = usePathname as jest.Mock;
const hrefs = () =>
  screen.getAllByRole("link").map((l) => l.getAttribute("href"));

describe("Breadcrumb — the layer-aware trail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJurisdictions = RESOLVED;
  });

  it("names the government rather than the level word", () => {
    // "Where you live / County" told the reader nothing. From a bill three
    // levels down, the county's actual name was invisible entirely.
    mockPathname.mockReturnValue("/region/bills/abc-123");
    render(
      <Breadcrumb
        segments={[
          { label: "Bills", href: "/region/bills" },
          { label: "AB 1157" },
        ]}
      />,
    );
    expect(screen.getByText("California")).toBeInTheDocument();
    expect(hrefs()).toEqual(["/region", "/region/state", "/region/bills"]);
  });

  it("uses the county's own name on county routes", () => {
    mockPathname.mockReturnValue("/region/county");
    render(<Breadcrumb segments={[]} />);
    expect(screen.getByText("Sonoma County")).toBeInTheDocument();
  });

  it("falls back to the level word before jurisdictions resolve", () => {
    mockJurisdictions = [];
    mockPathname.mockReturnValue("/region/county");
    render(<Breadcrumb segments={[]} />);
    expect(screen.getByText("stack.levels.county")).toBeInTheDocument();
  });

  it("does not link a layer page to itself", () => {
    mockPathname.mockReturnValue("/region/county");
    render(<Breadcrumb segments={[]} />);
    expect(hrefs()).toEqual(["/region"]);
  });

  it("maps campaign finance and its children to the state layer", () => {
    mockPathname.mockReturnValue("/region/campaign-finance/contributions");
    render(<Breadcrumb segments={[{ label: "Contributions" }]} />);
    expect(hrefs()).toContain("/region/state");
  });

  it("keeps meetings under the county the reader reached them from", () => {
    // The county page links here, so leaving it unmapped stranded readers
    // one level up with no way back. The mixed corpus (#1139) is a fact
    // about the rows, not about where the reader is standing.
    mockPathname.mockReturnValue("/region/meetings");
    render(<Breadcrumb segments={[{ label: "Meetings" }]} />);
    expect(hrefs()).toEqual(["/region", "/region/county"]);
    expect(screen.getByText("Sonoma County")).toBeInTheDocument();
  });

  it("leaves search unmapped — it is the axis across every layer", () => {
    mockPathname.mockReturnValue("/region/search");
    render(<Breadcrumb segments={[{ label: "Search" }]} />);
    expect(hrefs()).toEqual(["/region"]);
  });

  it("drops a root segment a legacy caller still passes", () => {
    mockPathname.mockReturnValue("/region/propositions");
    render(
      <Breadcrumb
        segments={[
          { label: "old root", href: "/region" },
          { label: "Propositions" },
        ]}
      />,
    );
    expect(hrefs().filter((h) => h === "/region")).toHaveLength(1);
  });
});

describe("RegionPageHeader — trail + title in one place", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJurisdictions = RESOLVED;
  });

  it("renders the title as the page heading", () => {
    mockPathname.mockReturnValue("/region/bills");
    render(<RegionPageHeader segments={[{ label: "Bills" }]} title="Bills" />);
    expect(screen.getByRole("heading", { name: "Bills" })).toBeInTheDocument();
  });

  it("lets the title end the trail instead of repeating it", () => {
    // A layer page's location and heading are the same jurisdiction, so
    // rendering both stacked "Sonoma County" over "Sonoma County".
    mockPathname.mockReturnValue("/region/county");
    render(<RegionPageHeader title="Sonoma County" />);
    expect(screen.getAllByText("Sonoma County")).toHaveLength(1);
  });

  it("keeps the trail intact when the title is not its last segment", () => {
    mockPathname.mockReturnValue("/region/bills");
    render(
      <RegionPageHeader segments={[{ label: "Bills" }]} title="California" />,
    );
    expect(screen.getByText("Bills")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "California" }),
    ).toBeInTheDocument();
  });

  it("renders a subtitle outside the pinned bar", () => {
    mockPathname.mockReturnValue("/region/bills");
    render(
      <RegionPageHeader
        segments={[{ label: "Bills" }]}
        title="Bills"
        subtitle="Legislation moving through your legislature"
      />,
    );
    expect(
      screen.getByText("Legislation moving through your legislature"),
    ).toBeInTheDocument();
  });
});
