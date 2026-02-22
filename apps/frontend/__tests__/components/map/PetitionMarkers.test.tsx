import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock supercluster (ESM module that Jest can't parse natively)
const mockLoad = jest.fn();
const mockGetClusters = jest.fn().mockReturnValue([]);
const mockGetLeaves = jest.fn().mockReturnValue([]);
jest.mock("supercluster", () => {
  return jest.fn().mockImplementation(() => ({
    load: mockLoad,
    getClusters: mockGetClusters,
    getLeaves: mockGetLeaves,
  }));
});

// Mock react-map-gl Marker to render children directly
jest.mock("react-map-gl/maplibre", () => ({
  Marker: ({
    children,
    latitude,
    longitude,
    onClick,
  }: {
    children: React.ReactNode;
    latitude: number;
    longitude: number;
    anchor: string;
    onClick?: (e: { originalEvent: { stopPropagation: () => void } }) => void;
  }) => (
    <div
      data-testid={`marker-${latitude.toFixed(2)}-${longitude.toFixed(2)}`}
      data-lat={latitude}
      data-lng={longitude}
      onClick={() =>
        onClick?.({
          originalEvent: { stopPropagation: jest.fn() },
        })
      }
    >
      {children}
    </div>
  ),
}));

// Must import after mocks
import { PetitionMarkers } from "@/components/map/PetitionMarkers";
import type { PetitionMapMarker } from "@/lib/graphql/documents";

// Mock requestAnimationFrame — do NOT invoke callback synchronously
// (invoking it would cause infinite recursion via setPulse -> re-render -> rAF)
jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

const mockMarkers: PetitionMapMarker[] = [
  {
    id: "doc-1",
    latitude: 37.77,
    longitude: -122.42,
    documentType: "petition",
    createdAt: "2024-06-01T00:00:00Z",
  },
  {
    id: "doc-2",
    latitude: 37.78,
    longitude: -122.41,
    documentType: "petition",
    createdAt: "2024-06-02T00:00:00Z",
  },
  {
    id: "doc-3",
    latitude: 34.05,
    longitude: -118.24,
    documentType: "proposition",
    createdAt: "2024-06-03T00:00:00Z",
  },
];

const wideBounds = {
  swLat: 30,
  swLng: -125,
  neLat: 40,
  neLng: -115,
};

describe("PetitionMarkers", () => {
  const defaultProps = {
    markers: mockMarkers,
    zoom: 6,
    bounds: wideBounds,
    selectedId: null,
    onSelect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: return individual markers (no clustering)
    mockGetClusters.mockReturnValue(
      mockMarkers.map((m) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [m.longitude, m.latitude] },
        properties: { marker: m },
      })),
    );
  });

  it("renders markers when given data and bounds", () => {
    const { container } = render(<PetitionMarkers {...defaultProps} />);

    const markers = container.querySelectorAll("[data-testid^='marker-']");
    expect(markers.length).toBe(3);
  });

  it("renders nothing when bounds are undefined", () => {
    const { container } = render(
      <PetitionMarkers {...defaultProps} bounds={undefined} />,
    );

    const markers = container.querySelectorAll("[data-testid^='marker-']");
    expect(markers.length).toBe(0);
  });

  it("renders nothing when markers are empty", () => {
    // Set getClusters to return empty BEFORE render
    mockGetClusters.mockReturnValue([]);

    const { container } = render(
      <PetitionMarkers {...defaultProps} markers={[]} />,
    );

    const markers = container.querySelectorAll("[data-testid^='marker-']");
    expect(markers.length).toBe(0);
  });

  it("renders count text in marker SVGs", () => {
    render(<PetitionMarkers {...defaultProps} />);

    // Each individual marker should show count "1"
    const ones = screen.getAllByText("1");
    expect(ones.length).toBe(3);
  });

  it("renders cluster with count when supercluster returns cluster feature", () => {
    mockGetClusters.mockReturnValue([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-122.42, 37.77] },
        properties: {
          cluster: true,
          cluster_id: 0,
          point_count: 5,
        },
      },
    ]);
    mockGetLeaves.mockReturnValue(
      mockMarkers.map((m) => ({
        properties: { marker: m },
      })),
    );

    render(<PetitionMarkers {...defaultProps} />);

    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("calls onSelect when clicking a marker", () => {
    const onSelect = jest.fn();
    const { container } = render(
      <PetitionMarkers {...defaultProps} onSelect={onSelect} />,
    );

    const markers = container.querySelectorAll("[data-testid^='marker-']");
    (markers[0] as HTMLElement).click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1" }),
    );
  });

  it("calls onSelect with null when clicking already-selected marker", () => {
    const onSelect = jest.fn();
    const { container } = render(
      <PetitionMarkers
        {...defaultProps}
        selectedId="doc-3"
        onSelect={onSelect}
      />,
    );

    // Find the LA marker
    const laMarker = container.querySelector(
      "[data-testid='marker-34.05--118.24']",
    );
    expect(laMarker).toBeTruthy();
    (laMarker as HTMLElement).click();

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("selects first marker when clicking a cluster", () => {
    const onSelect = jest.fn();

    mockGetClusters.mockReturnValue([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-122.42, 37.77] },
        properties: {
          cluster: true,
          cluster_id: 0,
          point_count: 3,
        },
      },
    ]);
    mockGetLeaves.mockReturnValue([
      { properties: { marker: mockMarkers[0] } },
      { properties: { marker: mockMarkers[1] } },
    ]);

    const { container } = render(
      <PetitionMarkers {...defaultProps} onSelect={onSelect} />,
    );

    const markers = container.querySelectorAll("[data-testid^='marker-']");
    (markers[0] as HTMLElement).click();

    // Should select the first marker in the cluster
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1" }),
    );
  });

  it("loads supercluster index with marker points", () => {
    render(<PetitionMarkers {...defaultProps} />);

    expect(mockLoad).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [-122.42, 37.77],
          },
        }),
      ]),
    );
  });

  it("calls getClusters with correct bbox and zoom", () => {
    render(<PetitionMarkers {...defaultProps} />);

    expect(mockGetClusters).toHaveBeenCalledWith(
      [-125, 30, -115, 40], // [swLng, swLat, neLng, neLat]
      6, // zoom
    );
  });

  it("starts animation loop on mount", () => {
    render(<PetitionMarkers {...defaultProps} />);

    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it("cancels animation on unmount", () => {
    const { unmount } = render(<PetitionMarkers {...defaultProps} />);

    unmount();

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("formats large cluster counts with k suffix", () => {
    mockGetClusters.mockReturnValue([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-122.42, 37.77] },
        properties: {
          cluster: true,
          cluster_id: 0,
          point_count: 2500,
        },
      },
    ]);
    mockGetLeaves.mockReturnValue([]);

    render(<PetitionMarkers {...defaultProps} />);

    expect(screen.getByText("2.5k")).toBeInTheDocument();
  });
});
