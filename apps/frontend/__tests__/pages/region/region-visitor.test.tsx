/**
 * The region pages for a visitor without an account (#1456).
 *
 * Signed-in behaviour is covered by each page's own test; these cover what
 * changes signed out: the lookup instead of a settings link, supervisors
 * and legislators from the device's districts, and no guarded query.
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useQuery } from "@apollo/client/react";
import RegionPage from "@/app/region/page";
import CountyLayerPage from "@/app/region/county/page";
import RepresentativesPage from "@/app/region/representatives/page";
import {
  COUNTY_SUPERVISORS_AT,
  GET_REPRESENTATIVES_BY_DISTRICTS,
  MY_COUNTY_SUPERVISORS,
} from "@/lib/graphql/region";
import { GET_MY_ADDRESSES } from "@/lib/graphql/profile";

jest.mock("@apollo/client/react", () => ({ useQuery: jest.fn() }));
jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
    i18n: { language: "en" },
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
jest.mock("next/image", () => {
  return function MockImage({ alt }: { alt: string }) {
    return <span>{alt}</span>;
  };
});
jest.mock("@/components/region/RegionPageHeader", () => ({
  RegionPageHeader: ({ title }: { title?: string }) => <h1>{title}</h1>,
}));
// The form and the control have their own tests; here only their presence.
jest.mock("@/components/region/LocateForm", () => ({
  LocateForm: () => <div data-testid="locate-form" />,
  VisitorLocationControl: () => <div data-testid="location-control" />,
}));

let mockJurisdictions: unknown[] = [];
jest.mock("@/components/region/JurisdictionsContext", () => ({
  useJurisdictions: () => ({
    jurisdictions: mockJurisdictions,
    loading: false,
    error: null,
    source: "device",
    setLocation: jest.fn(),
    clearLocation: jest.fn(),
  }),
}));

const mockUseQuery = useQuery as jest.Mock;

const row = (id: string, type: string, name: string, fipsCode?: string) => ({
  resolvedBy: "device",
  resolvedAt: "",
  jurisdiction: {
    id,
    name,
    type,
    level: "DISTRICT",
    stateCode: "CA",
    fipsCode,
  },
});

const LOCATED = [
  row("c", "COUNTY", "Sonoma County", "06097"),
  row(
    "s",
    "COUNTY_SUPERVISOR_DISTRICT",
    "Sonoma County Supervisorial District 3",
  ),
  row("a", "STATE_ASSEMBLY_DISTRICT", "California State Assembly District 2"),
  row("n", "STATE_SENATE_DISTRICT", "California State Senate District 2"),
];

const COURSEY = {
  id: "r3",
  name: "Chris Coursey",
  district: "3",
  chamber: "Board of Supervisors",
};
const WOOD = {
  id: "a2",
  name: "Jim Wood",
  district: "2",
  chamber: "Assembly",
};

/** Every query answered; skipped ones return nothing, as Apollo does. */
function answer() {
  mockUseQuery.mockImplementation(
    (document: unknown, options: { skip?: boolean } = {}) => {
      if (options.skip) return { data: undefined, loading: false };
      if (document === COUNTY_SUPERVISORS_AT) {
        return { data: { countySupervisorsAt: [COURSEY] }, loading: false };
      }
      if (document === GET_REPRESENTATIVES_BY_DISTRICTS) {
        return { data: { representativesByDistricts: [WOOD] }, loading: false };
      }
      return { data: undefined, loading: false };
    },
  );
}

/** True when the document was never run unskipped. */
function neverRan(document: unknown) {
  return mockUseQuery.mock.calls
    .filter(([doc]) => doc === document)
    .every(([, options]) => options?.skip === true);
}

beforeEach(() => {
  jest.clearAllMocks();
  answer();
});

describe("region home, signed out (#1456)", () => {
  it("offers the lookup when the visitor has no location", () => {
    mockJurisdictions = [];
    render(<RegionPage />);
    expect(screen.getByTestId("locate-form")).toBeInTheDocument();
    expect(screen.queryByText("stack.noAddress.body")).not.toBeInTheDocument();
  });

  it("shows the visitor's seat, with no link to account settings", () => {
    mockJurisdictions = LOCATED;
    const { container } = render(<RegionPage />);
    expect(screen.getByText(/Chris Coursey/)).toBeInTheDocument();
    expect(container.querySelector('a[href="/settings"]')).toBeNull();
    expect(screen.getByTestId("location-control")).toBeInTheDocument();
  });

  it("never runs the account's supervisor query", () => {
    mockJurisdictions = LOCATED;
    render(<RegionPage />);
    expect(neverRan(MY_COUNTY_SUPERVISORS)).toBe(true);
  });
});

describe("county page, signed out (#1456)", () => {
  it("offers the lookup when the visitor has no location", () => {
    mockJurisdictions = [];
    render(<CountyLayerPage />);
    expect(screen.getByTestId("locate-form")).toBeInTheDocument();
  });

  it("says the seat came from this device, not an address in settings", () => {
    mockJurisdictions = LOCATED;
    const { container } = render(<CountyLayerPage />);
    expect(
      screen.getByText("layer.county.resolvedFromDevice"),
    ).toBeInTheDocument();
    expect(container.querySelector('a[href="/settings"]')).toBeNull();
    expect(neverRan(MY_COUNTY_SUPERVISORS)).toBe(true);
  });
});

describe("representatives page, signed out (#1456)", () => {
  it("offers the lookup instead of a link to address settings", () => {
    mockJurisdictions = [];
    const { container } = render(<RepresentativesPage />);
    expect(screen.getByTestId("locate-form")).toBeInTheDocument();
    expect(container.querySelector('a[href="/settings/addresses"]')).toBeNull();
  });

  it("finds legislators from the device's districts, never the account's addresses", () => {
    mockJurisdictions = LOCATED;
    render(<RepresentativesPage />);
    expect(neverRan(GET_MY_ADDRESSES)).toBe(true);
    expect(neverRan(MY_COUNTY_SUPERVISORS)).toBe(true);
    const byDistricts = mockUseQuery.mock.calls.find(
      ([doc, options]) =>
        doc === GET_REPRESENTATIVES_BY_DISTRICTS && !options?.skip,
    );
    expect(byDistricts?.[1].variables).toEqual({
      stateAssemblyDistrict: "2",
      stateSenatorialDistrict: "2",
    });
    expect(screen.getAllByText("Jim Wood").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chris Coursey").length).toBeGreaterThan(0);
  });
});
