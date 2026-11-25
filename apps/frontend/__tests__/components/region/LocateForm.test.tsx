/**
 * Finding a visitor's districts without an account (#1456).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { CombinedGraphQLErrors } from "@apollo/client/errors";
import { useMutation } from "@apollo/client/react";
import {
  LocateForm,
  VisitorLocationControl,
  classifyLocateError,
} from "@/components/region/LocateForm";
import { LOCATE_JURISDICTIONS } from "@/lib/graphql/region";

expect.extend(toHaveNoViolations);

jest.mock("@apollo/client/react", () => ({ useMutation: jest.fn() }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockSetLocation = jest.fn();
const mockClearLocation = jest.fn();
let mockState = {
  source: "device" as "device" | "account" | null,
  jurisdictions: [] as unknown[],
};
jest.mock("@/components/region/JurisdictionsContext", () => ({
  useJurisdictions: () => ({
    ...mockState,
    loading: false,
    error: null,
    setLocation: mockSetLocation,
    clearLocation: mockClearLocation,
  }),
}));

const mockUseMutation = useMutation as jest.Mock;
const locate = jest.fn();

const ROWS = [{ id: "c", name: "Sonoma County", type: "COUNTY" }];

function graphqlError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: "x", extensions: { code } }],
  });
}

function stubGeolocation(
  impl: (ok: PositionCallback, fail: PositionErrorCallback) => void,
) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: jest.fn(impl) },
  });
}

function fillAddress() {
  fireEvent.change(screen.getByLabelText("locate.fields.line1"), {
    target: { value: "  1315 10th St  " },
  });
  fireEvent.change(screen.getByLabelText("locate.fields.city"), {
    target: { value: "Sacramento" },
  });
  fireEvent.change(screen.getByLabelText("locate.fields.postalCode"), {
    target: { value: "95814" },
  });
}

describe("LocateForm (#1456)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = { source: "device", jurisdictions: [] };
    mockUseMutation.mockReturnValue([locate]);
    locate.mockResolvedValue({ data: { locateJurisdictions: ROWS } });
  });

  it("sends nothing to the cache: the lookup is uncached", () => {
    render(<LocateForm />);
    expect(mockUseMutation).toHaveBeenCalledWith(LOCATE_JURISDICTIONS, {
      fetchPolicy: "no-cache",
    });
  });

  it("looks up an address once, trimmed, and keeps only the districts", async () => {
    const onLocated = jest.fn();
    render(<LocateForm onLocated={onLocated} />);
    fillAddress();
    fireEvent.click(
      screen.getByRole("button", { name: "locate.findDistricts" }),
    );

    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith(ROWS));
    expect(locate).toHaveBeenCalledTimes(1);
    expect(locate).toHaveBeenCalledWith({
      variables: {
        input: {
          address: {
            line1: "1315 10th St",
            city: "Sacramento",
            state: "CA",
            postalCode: "95814",
          },
        },
      },
    });
    expect(onLocated).toHaveBeenCalled();
    // The address is dropped from the form once it has been used.
    expect(screen.getByLabelText("locate.fields.line1")).toHaveValue("");
  });

  it("sends the browser's location rounded to about 11 m", async () => {
    stubGeolocation((ok) =>
      ok({
        coords: { latitude: 38.576712345, longitude: -121.493456789 },
      } as GeolocationPosition),
    );
    render(<LocateForm />);
    fireEvent.click(screen.getByRole("button", { name: "locate.useLocation" }));
    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith(ROWS));
    expect(locate).toHaveBeenCalledWith({
      variables: { input: { point: { lat: 38.5767, lng: -121.4935 } } },
    });
  });

  it("tells a refused permission apart from a failed position", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    render(<LocateForm />);
    fireEvent.click(screen.getByRole("button", { name: "locate.useLocation" }));
    expect(
      await screen.findByText("locate.problems.denied"),
    ).toBeInTheDocument();
    expect(locate).not.toHaveBeenCalled();

    stubGeolocation((_ok, fail) =>
      fail({ code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    fireEvent.click(screen.getByRole("button", { name: "locate.useLocation" }));
    expect(
      await screen.findByText("locate.problems.positionUnavailable"),
    ).toBeInTheDocument();
  });

  it("says so when the browser has no geolocation", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    // @ts-expect-error -- removing the API to simulate an old browser
    delete navigator.geolocation;
    render(<LocateForm />);
    fireEvent.click(screen.getByRole("button", { name: "locate.useLocation" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "locate.problems.noGeolocation",
    );
    if (original) Object.defineProperty(navigator, "geolocation", original);
  });

  it("says when an address matched no districts, and keeps nothing", async () => {
    locate.mockResolvedValue({ data: { locateJurisdictions: [] } });
    render(<LocateForm />);
    fillAddress();
    fireEvent.click(
      screen.getByRole("button", { name: "locate.findDistricts" }),
    );
    expect(
      await screen.findByText("locate.problems.notFound"),
    ).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("tells an unavailable geocoder apart from other failures", async () => {
    locate.mockRejectedValue(graphqlError("LOCATION_SERVICE_UNAVAILABLE"));
    render(<LocateForm />);
    fillAddress();
    fireEvent.click(
      screen.getByRole("button", { name: "locate.findDistricts" }),
    );
    expect(
      await screen.findByText("locate.problems.serviceUnavailable"),
    ).toBeInTheDocument();
  });

  it.each([
    [graphqlError("TOO_MANY_REQUESTS"), "rateLimited"],
    [Object.assign(new Error("429"), { statusCode: 429 }), "rateLimited"],
    [graphqlError("LOCATION_SERVICE_UNAVAILABLE"), "serviceUnavailable"],
    [graphqlError("INTERNAL_SERVER_ERROR"), "failed"],
    [new Error("network down"), "failed"],
  ])("classifies %p as %s", (error, expected) => {
    expect(classifyLocateError(error)).toBe(expected);
  });

  it("promises not to keep the location, next to both ways in", () => {
    render(<LocateForm />);
    const promise = screen.getByText("locate.promise");
    expect(
      screen.getByRole("button", { name: "locate.useLocation" }),
    ).toHaveAttribute("aria-describedby", promise.id);
  });

  it("has no axe violations", async () => {
    const { container } = render(<LocateForm />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("VisitorLocationControl (#1456)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMutation.mockReturnValue([locate]);
  });

  it("renders nothing for a signed-in reader, whose location is in settings", () => {
    mockState = { source: "account", jurisdictions: [{}] };
    const { container } = render(<VisitorLocationControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a visitor with no location yet", () => {
    mockState = { source: "device", jurisdictions: [] };
    const { container } = render(<VisitorLocationControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lets a visitor change or clear a saved location", async () => {
    mockState = { source: "device", jurisdictions: [{}] };
    const { container } = render(<VisitorLocationControl />);
    const change = screen.getByRole("button", { name: "locate.change" });
    expect(change).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(change);
    expect(change).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("locate.title")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "locate.clear" }));
    expect(mockClearLocation).toHaveBeenCalled();
  });
});
