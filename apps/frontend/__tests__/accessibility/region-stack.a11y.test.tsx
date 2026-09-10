/**
 * WCAG 2.2 AA accessibility tests for the jurisdiction stack (#1194).
 *
 * Two properties matter more than the generic axe sweep here:
 *
 * 1. The county's gold left rule is wayfinding. Colour must never be the
 *    only carrier of it (SC 1.4.1), so the level word has to be in the
 *    accessible name too.
 * 2. The seat line sits *outside* the card's own <Link>. A nested anchor is
 *    invalid HTML and the inner one drops out of the tab order entirely.
 */

import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";
import { useQuery } from "@apollo/client/react";
import RegionPage from "@/app/region/page";
import {
  GET_BILLS,
  GET_REPRESENTATIVES_BY_DISTRICTS,
  MY_COUNTY_SUPERVISORS,
  MY_JURISDICTIONS,
} from "@/lib/graphql/region";

expect.extend(toHaveNoViolations);

jest.mock("@apollo/client/react", () => ({ useQuery: jest.fn() }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

const jurisdiction = (type: string, name: string, level: string) => ({
  resolvedBy: "address",
  resolvedAt: "2026-09-01T00:00:00Z",
  jurisdiction: { id: type, name, type, level, stateCode: "CA" },
});

const JURISDICTIONS = [
  jurisdiction("COUNTY", "Sonoma County", "COUNTY"),
  jurisdiction("CONGRESSIONAL_DISTRICT", "CA-04", "FEDERAL"),
  {
    ...jurisdiction(
      "STATE_ASSEMBLY_DISTRICT",
      "California State Assembly District 2",
      "STATE",
    ),
    jurisdiction: {
      ...jurisdiction(
        "STATE_ASSEMBLY_DISTRICT",
        "California State Assembly District 2",
        "STATE",
      ).jurisdiction,
      parent: { id: "ca", name: "California", type: "STATE", level: "STATE" },
    },
  },
];

const SUPERVISOR = {
  id: "sup-5",
  name: "Lynda Hopkins",
  chamber: "Board of Supervisors",
  district: "5",
  party: null,
  photoUrl: null,
};

beforeEach(() => {
  (useQuery as jest.Mock).mockImplementation((document: unknown) => {
    if (document === MY_JURISDICTIONS)
      return {
        data: { myJurisdictions: JURISDICTIONS },
        loading: false,
        error: null,
      };
    if (document === MY_COUNTY_SUPERVISORS)
      return {
        data: { myCountySupervisors: [SUPERVISOR] },
        loading: false,
        error: null,
      };
    if (document === GET_REPRESENTATIVES_BY_DISTRICTS)
      return {
        data: { representativesByDistricts: [] },
        loading: false,
        error: null,
      };
    if (document === GET_BILLS)
      return {
        data: {
          bills: {
            items: [{ id: "b1", lastActionDate: null }],
            total: 1,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
      };
    return { data: undefined, loading: false, error: null };
  });
});

describe("Jurisdiction stack — WCAG 2.2 AA", () => {
  it("has no axe violations", async () => {
    const { container } = render(<RegionPage />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has exactly one h1 and no skipped heading levels", () => {
    render(<RegionPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const levels = screen
      .getAllByRole("heading")
      .map((h) => Number(h.tagName.substring(1)))
      .sort((a, b) => a - b);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it("does not rely on the gold rule alone to mark the county (SC 1.4.1)", () => {
    render(<RegionPage />);
    const card = screen.getByText("Sonoma County").closest("a");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("stack.levels.county");
  });

  it("keeps every card link reachable and named", () => {
    render(<RegionPage />);
    for (const href of ["/region/county", "/region/state", "/region/federal"]) {
      const link = screen
        .getAllByRole("link")
        .find((l) => l.getAttribute("href") === href);
      expect(link).toBeDefined();
      expect(link).toHaveAccessibleName();
    }
  });

  it("nests no anchor inside the card's own anchor", () => {
    // Invalid HTML, and the inner link silently leaves the tab order.
    const { container } = render(<RegionPage />);
    expect(container.querySelector("a a")).toBeNull();
  });
});
