/**
 * The region pages' one source of jurisdictions, signed in or not (#1456).
 *
 * The properties that matter for a visitor without an account:
 * - no account query ever runs for them (a 401 would start a session refresh);
 * - their location comes only from ids on their device, read with
 *   `no-cache` so the persisted Apollo cache never becomes a second copy;
 * - clearing the location clears it.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useQuery } from "@apollo/client/react";
import {
  JurisdictionsProvider,
  useJurisdictions,
} from "@/components/region/JurisdictionsContext";
import { useCountySupervisors } from "@/lib/hooks/useCountySupervisors";
import {
  COUNTY_SUPERVISORS_AT,
  JURISDICTIONS_BY_IDS,
  MY_COUNTY_SUPERVISORS,
  MY_JURISDICTIONS,
  type JurisdictionData,
} from "@/lib/graphql/region";
import {
  VISITOR_LOCATION_KEY,
  readVisitorJurisdictionIds,
} from "@/lib/visitor-location";

jest.mock("@apollo/client/react", () => ({ useQuery: jest.fn() }));

let mockAuth = { isAuthenticated: false, isLoading: false };
jest.mock("@/lib/auth-context", () => ({ useAuth: () => mockAuth }));

const mockUseQuery = useQuery as jest.Mock;

const COUNTY_ID = "8cc8fa26-7e97-42fa-b5eb-894a8801fff6";
const SUP_ID = "552006e2-2fb7-4fd1-9e9a-3dda7ea42da3";

const jurisdiction = (id: string, type: string, name: string) =>
  ({
    id,
    name,
    type,
    level: type === "COUNTY" ? "COUNTY" : "DISTRICT",
    stateCode: "CA",
  }) as JurisdictionData;

const SONOMA = jurisdiction(COUNTY_ID, "COUNTY", "Sonoma County");
const SUP_3 = jurisdiction(
  SUP_ID,
  "COUNTY_SUPERVISOR_DISTRICT",
  "Sonoma County Supervisorial District 3",
);

const COURSEY = { id: "r3", name: "Chris Coursey", district: "3" };

/** The options each document was last called with. */
function optionsFor(document: unknown) {
  const calls = mockUseQuery.mock.calls.filter(([doc]) => doc === document);
  return calls.at(-1)?.[1] ?? {};
}

/** Answer every document as the server would; skipped ones return nothing. */
function answer(byIds: JurisdictionData[] = []) {
  mockUseQuery.mockImplementation(
    (document: unknown, options: { skip?: boolean } = {}) => {
      if (options.skip) return { data: undefined, loading: false };
      if (document === JURISDICTIONS_BY_IDS) {
        return { data: { jurisdictionsByIds: byIds }, loading: false };
      }
      if (document === COUNTY_SUPERVISORS_AT) {
        return { data: { countySupervisorsAt: [COURSEY] }, loading: false };
      }
      if (document === MY_JURISDICTIONS) {
        return {
          data: {
            myJurisdictions: [
              { resolvedBy: "address", resolvedAt: "x", jurisdiction: SONOMA },
            ],
          },
          loading: false,
        };
      }
      if (document === MY_COUNTY_SUPERVISORS) {
        return { data: { myCountySupervisors: [COURSEY] }, loading: false };
      }
      return { data: undefined, loading: false };
    },
  );
}

/** Renders the context, with buttons standing in for a page's controls. */
function Probe() {
  const latest = useJurisdictions();
  const supervisors = useCountySupervisors();
  return (
    <ul>
      <li>
        <button onClick={() => latest.setLocation([SONOMA])}>set county</button>
        <button onClick={() => latest.setLocation([SONOMA, SUP_3])}>
          set both
        </button>
        <button onClick={() => latest.setLocation([SUP_3])}>set seat</button>
        <button onClick={() => latest.clearLocation()}>clear</button>
      </li>
      <li data-testid="source">{String(latest.source)}</li>
      <li data-testid="loading">{String(latest.loading)}</li>
      <li data-testid="names">
        {latest.jurisdictions.map((j) => j.jurisdiction.name).join("|")}
      </li>
      <li data-testid="supervisors">
        {supervisors.map((s) => s.name).join("|")}
      </li>
    </ul>
  );
}

function renderProvider() {
  return render(
    <JurisdictionsProvider>
      <Probe />
    </JurisdictionsProvider>,
  );
}

describe("JurisdictionsProvider (#1456)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseQuery.mockReset();
    mockAuth = { isAuthenticated: false, isLoading: false };
    answer();
  });

  describe("signed in", () => {
    beforeEach(() => {
      mockAuth = { isAuthenticated: true, isLoading: false };
    });

    it("reads the account's jurisdictions and supervisors, as before", () => {
      renderProvider();
      expect(screen.getByTestId("source")).toHaveTextContent("account");
      expect(screen.getByTestId("names")).toHaveTextContent("Sonoma County");
      expect(screen.getByTestId("supervisors")).toHaveTextContent(
        "Chris Coursey",
      );
      expect(optionsFor(MY_JURISDICTIONS).skip).toBe(false);
    });

    it("never runs the visitor queries", () => {
      localStorage.setItem(VISITOR_LOCATION_KEY, JSON.stringify([COUNTY_ID]));
      renderProvider();
      expect(optionsFor(JURISDICTIONS_BY_IDS).skip).toBe(true);
      expect(optionsFor(COUNTY_SUPERVISORS_AT).skip).toBe(true);
    });

    it("ignores setLocation: the location is the saved address", () => {
      renderProvider();
      fireEvent.click(screen.getByText("set seat"));
      expect(readVisitorJurisdictionIds()).toEqual([]);
    });
  });

  describe("signed out", () => {
    it("runs no account query, so no 401 starts a session refresh", () => {
      renderProvider();
      expect(optionsFor(MY_JURISDICTIONS).skip).toBe(true);
      expect(optionsFor(MY_COUNTY_SUPERVISORS).skip).toBe(true);
    });

    it("has no location and asks nothing until one is set", () => {
      renderProvider();
      expect(screen.getByTestId("source")).toHaveTextContent("device");
      expect(screen.getByTestId("names")).toBeEmptyDOMElement();
      expect(optionsFor(JURISDICTIONS_BY_IDS).skip).toBe(true);
      expect(optionsFor(COUNTY_SUPERVISORS_AT).skip).toBe(true);
    });

    it("restores a saved location from the device's ids, uncached", () => {
      localStorage.setItem(
        VISITOR_LOCATION_KEY,
        JSON.stringify([COUNTY_ID, SUP_ID]),
      );
      answer([SONOMA, SUP_3]);
      renderProvider();
      const byIds = optionsFor(JURISDICTIONS_BY_IDS);
      expect(byIds.skip).toBe(false);
      expect(byIds.variables).toEqual({ ids: [COUNTY_ID, SUP_ID] });
      expect(byIds.fetchPolicy).toBe("no-cache");
      expect(screen.getByTestId("names")).toHaveTextContent(
        "Sonoma County|Sonoma County Supervisorial District 3",
      );
    });

    it("finds the visitor's supervisor from the same ids, uncached", () => {
      localStorage.setItem(VISITOR_LOCATION_KEY, JSON.stringify([COUNTY_ID]));
      answer([SONOMA]);
      renderProvider();
      const sups = optionsFor(COUNTY_SUPERVISORS_AT);
      expect(sups.variables).toEqual({ ids: [COUNTY_ID] });
      expect(sups.fetchPolicy).toBe("no-cache");
      expect(screen.getByTestId("supervisors")).toHaveTextContent(
        "Chris Coursey",
      );
    });

    it("saves only the ids of a new location, and shows it without a round trip", () => {
      renderProvider();
      fireEvent.click(screen.getByText("set both"));
      expect(readVisitorJurisdictionIds()).toEqual([COUNTY_ID, SUP_ID]);
      expect(screen.getByTestId("names")).toHaveTextContent("Sonoma County");
      expect(optionsFor(JURISDICTIONS_BY_IDS).skip).toBe(true);
    });

    it("forgets the location when cleared", () => {
      renderProvider();
      fireEvent.click(screen.getByText("set county"));
      fireEvent.click(screen.getByText("clear"));
      expect(localStorage.getItem(VISITOR_LOCATION_KEY)).toBeNull();
      expect(screen.getByTestId("names")).toBeEmptyDOMElement();
    });

    it("keeps the location for the page's life when storage refuses it", () => {
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      renderProvider();
      fireEvent.click(screen.getByText("set county"));
      expect(screen.getByTestId("names")).toHaveTextContent("Sonoma County");
      jest.restoreAllMocks();
    });

    it("follows a location replaced in another tab", () => {
      renderProvider();
      fireEvent.click(screen.getByText("set county"));
      answer([SUP_3]);
      act(() => {
        localStorage.setItem(VISITOR_LOCATION_KEY, JSON.stringify([SUP_ID]));
        globalThis.dispatchEvent(
          new StorageEvent("storage", { key: VISITOR_LOCATION_KEY }),
        );
      });
      expect(optionsFor(JURISDICTIONS_BY_IDS).variables).toEqual({
        ids: [SUP_ID],
      });
      expect(screen.getByTestId("names")).toHaveTextContent(
        "Sonoma County Supervisorial District 3",
      );
    });
  });

  it("waits for sign-in state before running either path", () => {
    mockAuth = { isAuthenticated: false, isLoading: true };
    renderProvider();
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(optionsFor(MY_JURISDICTIONS).skip).toBe(true);
    expect(optionsFor(JURISDICTIONS_BY_IDS).skip).toBe(true);
  });
});
