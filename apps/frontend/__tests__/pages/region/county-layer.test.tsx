import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useQuery } from "@apollo/client/react";
import CountyLayerPage from "@/app/region/county/page";
import {
  GET_MEETINGS,
  GET_REPRESENTATIVES,
  MY_COUNTY_SUPERVISORS,
} from "@/lib/graphql/region";
import { GET_COUNTY_THRESHOLDS } from "@/lib/graphql/counties";

jest.mock("@apollo/client/react", () => ({ useQuery: jest.fn() }));
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
jest.mock("@/components/region/RegionPageHeader", () => ({
  RegionPageHeader: ({
    title,
    meta,
  }: {
    title?: string;
    meta?: React.ReactNode;
  }) => (
    <>
      <h1>{title}</h1>
      <p>{meta}</p>
    </>
  ),
}));

const COUNTY = {
  resolvedBy: "address",
  resolvedAt: "2026-09-01T00:00:00Z",
  jurisdiction: {
    id: "c",
    name: "Sonoma County",
    type: "COUNTY",
    level: "COUNTY",
    stateCode: "CA",
    fipsCode: "06097",
  },
};

let state = {
  jurisdictions: [COUNTY] as unknown[],
  loading: false,
  error: null,
};
jest.mock("@/components/region/JurisdictionsContext", () => ({
  useJurisdictions: () => state,
}));

const BOARD = [
  {
    id: "s1",
    name: "Rebecca Hermosillo",
    chamber: "Board of Supervisors",
    district: "1",
  },
  {
    id: "s2",
    name: "David Rabbitt",
    chamber: "Board of Supervisors",
    district: "2",
  },
  {
    id: "s3",
    name: "Chris Coursey",
    chamber: "Board of Supervisors",
    district: "3",
  },
  {
    id: "s4",
    name: "James Gore",
    chamber: "Board of Supervisors",
    district: "4",
  },
  {
    id: "sup-5",
    name: "Lynda Hopkins",
    chamber: "Board of Supervisors",
    district: "5",
  },
];

const board = (i: number) => ({
  id: `m${i}`,
  title: `Board meeting ${i}`,
  body: "Board of Supervisors",
  scheduledAt: "2026-09-01T00:00:00Z",
});
const assembly = (i: number) => ({
  id: `a${i}`,
  title: `Assembly meeting ${i}`,
  body: "Assembly",
  scheduledAt: "2026-09-08T00:00:00Z",
});

function setup(
  meetings: unknown[],
  supervisors: unknown[] = [],
  roster: unknown[] = BOARD,
) {
  state = { jurisdictions: [COUNTY], loading: false, error: null };
  (useQuery as jest.Mock).mockImplementation((document: unknown) => {
    if (document === MY_COUNTY_SUPERVISORS)
      return {
        data: { myCountySupervisors: supervisors },
        loading: false,
        error: null,
      };
    if (document === GET_COUNTY_THRESHOLDS)
      return {
        data: {
          countyThresholds: [
            {
              fips: "06097",
              name: "Sonoma County",
              signaturesRequired: 19746,
              gubernatorialYear: 2022,
              sourceUrl: "https://sos.ca.gov/example",
            },
          ],
        },
        loading: false,
        error: null,
      };
    if (document === GET_REPRESENTATIVES)
      return {
        data: {
          representatives: {
            items: roster,
            total: roster.length,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
      };
    if (document === GET_MEETINGS)
      return {
        data: {
          meetings: { items: meetings, total: meetings.length, hasMore: false },
        },
        loading: false,
        error: null,
      };
    return { data: undefined, loading: false, error: null };
  });
}

describe("County layer page (#1195)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows only board meetings, never legislative ones", () => {
    // The table has no jurisdiction column (#1139); Assembly rows sharing it
    // must not render as county business.
    setup([assembly(1), board(1), assembly(2), board(2)]);
    render(<CountyLayerPage />);
    expect(screen.getByText("Board meeting 1")).toBeInTheDocument();
    expect(screen.queryByText("Assembly meeting 1")).not.toBeInTheDocument();
  });

  it("finds board meetings even when legislative ones dominate the newest rows", () => {
    // The regression this probe size exists for: Assembly meetings cluster
    // at the top (11 of the newest 25 in production today), so a narrow
    // window emptied the section while hundreds of board meetings existed.
    const meetings = [
      ...Array.from({ length: 30 }, (_, i) => assembly(i)),
      board(99),
    ];
    setup(meetings);
    render(<CountyLayerPage />);
    expect(screen.getByText("Board meeting 99")).toBeInTheDocument();
  });

  it("distinguishes 'none in what we checked' from 'none exist'", () => {
    setup(Array.from({ length: 100 }, (_, i) => assembly(i)));
    render(<CountyLayerPage />);
    expect(
      screen.getByText("layer.county.noMeetingsInWindow"),
    ).toBeInTheDocument();
  });

  it("says none recorded when the corpus itself is short", () => {
    setup([assembly(1)]);
    render(<CountyLayerPage />);
    expect(screen.getByText("layer.county.noMeetings")).toBeInTheDocument();
  });

  it("matches the threshold on FIPS, not on name", () => {
    setup([board(1)]);
    render(<CountyLayerPage />);
    expect(screen.getByText("19,746")).toBeInTheDocument();
  });

  it("links the resolved supervisor to their profile", () => {
    setup(
      [board(1)],
      [
        {
          id: "sup-5",
          name: "Lynda Hopkins",
          chamber: "Board of Supervisors",
          district: "5",
        },
      ],
    );
    render(<CountyLayerPage />);
    const link = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("href") === "/region/representatives/sup-5");
    expect(link).toBeDefined();
  });

  it("counts seats from the whole board, not the reader's filtered slice", () => {
    // myCountySupervisors returns one supervisor once the district resolves
    // (#1136), so its length is not the size of the board.
    setup([board(1)], [BOARD[4]]);
    render(<CountyLayerPage />);
    expect(screen.getByText(/"count":5/)).toBeInTheDocument();
  });

  it("lists the other seats by surname, excluding the reader's own", () => {
    setup([board(1)], [BOARD[4]]);
    render(<CountyLayerPage />);
    const others = screen.getByText(/Hermosillo · Rabbitt · Coursey · Gore/);
    expect(others).toBeInTheDocument();
    expect(others.textContent).not.toContain("Hopkins");
  });

  it("keeps future meetings out of 'what the county did'", () => {
    // The feed is scheduledAt-descending, so upcoming meetings sit at its
    // head; rendering them as past activity reported meetings that had not
    // happened yet as things the county had already done.
    const future = {
      id: "future",
      title: "Upcoming board meeting",
      body: "Board of Supervisors",
      scheduledAt: "2099-01-01T00:00:00Z",
    };
    setup([future, board(1)]);
    render(<CountyLayerPage />);
    expect(
      screen.queryByText("Upcoming board meeting"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Board meeting 1")).toBeInTheDocument();
  });

  it("surfaces the soonest upcoming meeting in the header", () => {
    const soon = {
      id: "soon",
      title: "Next board meeting",
      body: "Board of Supervisors",
      scheduledAt: "2099-01-01T00:00:00Z",
    };
    const later = {
      id: "later",
      title: "Later board meeting",
      body: "Board of Supervisors",
      scheduledAt: "2099-06-01T00:00:00Z",
    };
    setup([later, soon]);
    render(<CountyLayerPage />);
    expect(screen.getByText(/layer.county.nextMeeting/)).toBeInTheDocument();
  });
});
