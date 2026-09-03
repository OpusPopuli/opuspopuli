import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { CivicMap, backgroundOnlyStyle } from "@/components/map/CivicMap";

const mapInstance = {
  addControl: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  remove: jest.fn(),
  setStyle: jest.fn(),
  getCenter: jest.fn(() => ({ lng: -119.4, lat: 36.8 })),
  getZoom: jest.fn(() => 5),
};

const overlayInstance = {
  setProps: jest.fn(),
  finalize: jest.fn(),
};

jest.mock("maplibre-gl", () => ({
  __esModule: true,
  default: { Map: jest.fn(() => mapInstance) },
  Map: jest.fn(() => mapInstance),
}));

jest.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: jest.fn(() => overlayInstance),
}));

jest.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}), { virtual: true });

const maplibregl = require("maplibre-gl");

const { MapboxOverlay } = require("@deck.gl/mapbox");

const VIEW = { longitude: -119.4, latitude: 36.8, zoom: 5 };

describe("backgroundOnlyStyle", () => {
  it("issues zero external requests — no sources, glyphs or sprite", () => {
    // The privacy property this component exists to hold: a basemap would send
    // every visitor's viewport to a tile vendor before they agreed to anything.
    // Adding "just a basemap" later has to fail here.
    const style = backgroundOnlyStyle("#0a0f1a");

    expect(style.sources).toEqual({});
    expect(style).not.toHaveProperty("glyphs");
    expect(style).not.toHaveProperty("sprite");
    expect(JSON.stringify(style)).not.toMatch(/https?:\/\//);
  });

  it("renders only a background layer, in the requested colour", () => {
    const style = backgroundOnlyStyle("#123456");

    expect(style.layers).toHaveLength(1);
    expect(style.layers[0]).toMatchObject({
      type: "background",
      paint: { "background-color": "#123456" },
    });
  });

  it("returns a fresh object per call", () => {
    // A shared style object would let one caller's colour leak into another's.
    expect(backgroundOnlyStyle("#111111")).not.toBe(
      backgroundOnlyStyle("#111111"),
    );
  });
});

describe("CivicMap", () => {
  beforeEach(() => jest.clearAllMocks());

  it("constructs the map with a background-only style and no attribution", () => {
    render(<CivicMap layers={[]} initialViewState={VIEW} ariaLabel="Map" />);

    const opts = maplibregl.default.Map.mock.calls[0][0];
    expect(opts.style.sources).toEqual({});
    expect(opts.attributionControl).toBe(false);
    expect(opts.center).toEqual([-119.4, 36.8]);
    expect(opts.zoom).toBe(5);
  });

  it("is non-interactive by default", () => {
    // A decorative map that steals scroll on a landing page is a usability
    // failure, and a fixed frame is what makes the #1110 snapshot swappable.
    render(<CivicMap layers={[]} initialViewState={VIEW} ariaLabel="Map" />);

    expect(maplibregl.default.Map.mock.calls[0][0].interactive).toBe(false);
  });

  it("adds the deck.gl overlay interleaved", () => {
    render(<CivicMap layers={[]} initialViewState={VIEW} ariaLabel="Map" />);

    expect(MapboxOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ interleaved: true }),
    );
    expect(mapInstance.addControl).toHaveBeenCalledWith(overlayInstance);
  });

  it("pushes new layers through the overlay instead of remounting the map", () => {
    const { rerender } = render(
      <CivicMap layers={[]} initialViewState={VIEW} ariaLabel="Map" />,
    );
    const constructions = maplibregl.default.Map.mock.calls.length;

    const layer = { id: "counties" } as never;
    rerender(
      <CivicMap layers={[layer]} initialViewState={VIEW} ariaLabel="Map" />,
    );

    expect(overlayInstance.setProps).toHaveBeenCalledWith({ layers: [layer] });
    // Remounting would restart the map and reset the camera under the user.
    expect(maplibregl.default.Map.mock.calls.length).toBe(constructions);
  });

  it("tears the map down on unmount", () => {
    const { unmount } = render(
      <CivicMap layers={[]} initialViewState={VIEW} ariaLabel="Map" />,
    );

    unmount();

    expect(overlayInstance.finalize).toHaveBeenCalled();
    expect(mapInstance.remove).toHaveBeenCalled();
  });

  it("exposes an accessible name", () => {
    // A canvas is opaque to assistive technology; an unlabelled interactive
    // region fails WCAG 2.2 AA (1.1.1, 4.1.2).
    render(
      <CivicMap
        layers={[]}
        initialViewState={VIEW}
        ariaLabel="California counties by signatures required"
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "California counties by signatures required",
      }),
    ).toBeInTheDocument();
  });
});

describe("shared-abstraction contract (#1105 criterion 10)", () => {
  it("contains no California, county or threshold concepts", () => {
    // The petition map is the second consumer. If domain vocabulary leaks in
    // here, this stops being shared and the next surface forks it instead.
    const source = readFileSync(
      join(__dirname, "../../../components/map/CivicMap.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    for (const term of [
      "county",
      "counties",
      "threshold",
      "california",
      "signature",
      "9118",
    ]) {
      expect(code.toLowerCase()).not.toContain(term);
    }
  });
});
