import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MapPageClient } from "@/app/petition/map/MapPageClient";

// Mock map components to avoid maplibre-gl/WebGL issues in test env
jest.mock("@/components/map/MapView", () => ({
  MapView: ({
    children,
    onMoveEnd,
  }: {
    children: React.ReactNode;
    onMoveEnd?: (bounds: {
      swLat: number;
      swLng: number;
      neLat: number;
      neLng: number;
    }) => void;
  }) => (
    <div data-testid="map-view">
      {children}
      <button
        data-testid="trigger-move"
        onClick={() =>
          onMoveEnd?.({ swLat: 34, swLng: -119, neLat: 38, neLng: -117 })
        }
      >
        Trigger Move
      </button>
    </div>
  ),
}));

jest.mock("@/components/map/PetitionMarkers", () => ({
  PetitionMarkers: () => <div data-testid="petition-markers" />,
}));

jest.mock("@/components/map/PetitionSidebar", () => ({
  PetitionSidebar: ({
    markers,
    loading,
  }: {
    markers: unknown[];
    loading: boolean;
  }) => (
    <div data-testid="petition-sidebar">
      <span data-testid="marker-count">{markers.length}</span>
      <span data-testid="loading-state">{String(loading)}</span>
    </div>
  ),
}));

jest.mock("@/components/map/MapLegend", () => ({
  MapLegend: () => <div data-testid="map-legend" />,
}));

jest.mock("@/components/map/MapFilters", () => ({
  MapFilters: ({
    onNearMe,
    locationLoading,
  }: {
    onNearMe: () => void;
    locationLoading: boolean;
  }) => (
    <div data-testid="map-filters">
      <button data-testid="near-me-btn" onClick={onNearMe}>
        {locationLoading ? "Locating..." : "Near me"}
      </button>
    </div>
  ),
}));

// Mock hooks
const mockUpdateBounds = jest.fn();
const mockUpdateFilters = jest.fn();
jest.mock("@/lib/hooks/useMapPetitions", () => ({
  useMapPetitions: () => ({
    markers: [],
    stats: null,
    loading: false,
    error: null,
    updateBounds: mockUpdateBounds,
    updateFilters: mockUpdateFilters,
    filters: {},
  }),
}));

const mockRequestLocation = jest.fn();
jest.mock("@/lib/hooks/useGeolocation", () => ({
  useGeolocation: () => ({
    requestLocation: mockRequestLocation,
    isLoading: false,
  }),
}));

describe("MapPageClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear hash
    window.location.hash = "";
  });

  it("renders header with branding", () => {
    render(<MapPageClient />);

    expect(screen.getByText("Opus Populi")).toBeInTheDocument();
    expect(screen.getByText("Civic Petition Map")).toBeInTheDocument();
  });

  it("renders layer toggle buttons", () => {
    render(<MapPageClient />);

    expect(
      screen.getByRole("button", { name: "Show clusters layer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show both layer" }),
    ).toBeInTheDocument();
  });

  it("renders map view", () => {
    render(<MapPageClient />);

    expect(screen.getByTestId("map-view")).toBeInTheDocument();
  });

  it("renders petition markers inside map", () => {
    render(<MapPageClient />);

    expect(screen.getByTestId("petition-markers")).toBeInTheDocument();
  });

  it("renders sidebar", () => {
    render(<MapPageClient />);

    expect(screen.getByTestId("petition-sidebar")).toBeInTheDocument();
  });

  it("renders map legend", () => {
    render(<MapPageClient />);

    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
  });

  it("renders map filters", () => {
    render(<MapPageClient />);

    expect(screen.getByTestId("map-filters")).toBeInTheDocument();
  });

  it("toggles active layer on button click", async () => {
    const user = userEvent.setup();
    render(<MapPageClient />);

    const bothBtn = screen.getByRole("button", { name: "Show both layer" });
    await user.click(bothBtn);

    // "both" button should now be active (aria-pressed=true)
    expect(bothBtn).toHaveAttribute("aria-pressed", "true");

    const clustersBtn = screen.getByRole("button", {
      name: "Show clusters layer",
    });
    // clusters should not be active
    expect(clustersBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("calls updateBounds on map move", async () => {
    const user = userEvent.setup();
    render(<MapPageClient />);

    await user.click(screen.getByTestId("trigger-move"));

    expect(mockUpdateBounds).toHaveBeenCalledWith({
      swLat: 34,
      swLng: -119,
      neLat: 38,
      neLng: -117,
    });
  });

  it("has clusters as default active layer", () => {
    render(<MapPageClient />);

    const clustersBtn = screen.getByRole("button", {
      name: "Show clusters layer",
    });
    expect(clustersBtn).toHaveAttribute("aria-pressed", "true");
  });
});
