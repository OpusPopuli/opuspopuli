import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { PetitionSidebar } from "@/components/map/PetitionSidebar";
import type {
  PetitionMapMarker,
  PetitionMapStats,
} from "@/lib/graphql/documents";

const mockMarkers: PetitionMapMarker[] = [
  {
    id: "doc-1",
    latitude: 37.7749,
    longitude: -122.4194,
    documentType: "petition",
    createdAt: "2024-06-01T00:00:00Z",
  },
  {
    id: "doc-2",
    latitude: 34.0522,
    longitude: -118.2437,
    documentType: "proposition",
    createdAt: "2024-06-15T00:00:00Z",
  },
  {
    id: "doc-3",
    latitude: 36.7783,
    longitude: -119.4179,
    createdAt: "2024-06-10T00:00:00Z",
  },
];

const mockStats: PetitionMapStats = {
  totalPetitions: 42,
  totalWithLocation: 35,
  recentPetitions: 8,
};

describe("PetitionSidebar", () => {
  const defaultProps = {
    markers: mockMarkers,
    stats: mockStats,
    selectedMarker: null,
    onSelect: jest.fn(),
    loading: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders petition count in header", () => {
    render(<PetitionSidebar {...defaultProps} />);

    expect(
      screen.getByText(`All Petitions (${mockMarkers.length})`),
    ).toBeInTheDocument();
  });

  it("renders all petition list items", () => {
    render(<PetitionSidebar {...defaultProps} />);

    expect(screen.getAllByRole("option")).toHaveLength(mockMarkers.length);
  });

  it("renders petition type and truncated ID", () => {
    render(<PetitionSidebar {...defaultProps} />);

    // doc-1 has documentType "petition"
    expect(screen.getByText(/petition · doc-1/)).toBeInTheDocument();
    // doc-2 has documentType "proposition"
    expect(screen.getByText(/proposition · doc-2/)).toBeInTheDocument();
  });

  it("renders fallback type for markers without documentType", () => {
    render(<PetitionSidebar {...defaultProps} />);

    // doc-3 has no documentType, should show "Petition"
    expect(screen.getByText(/Petition · doc-3/)).toBeInTheDocument();
  });

  it("renders stats footer with correct values", () => {
    render(<PetitionSidebar {...defaultProps} />);

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // In View count
    expect(screen.getByText("Total Petitions")).toBeInTheDocument();
    expect(screen.getByText("With Location")).toBeInTheDocument();
    expect(screen.getByText("Recent (7d)")).toBeInTheDocument();
    expect(screen.getByText("In View")).toBeInTheDocument();
  });

  it("renders dash for stats when null", () => {
    render(<PetitionSidebar {...defaultProps} stats={null} />);

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(3); // totalPetitions, totalWithLocation, recentPetitions
  });

  it("shows selected petition detail when marker is selected", () => {
    render(
      <PetitionSidebar {...defaultProps} selectedMarker={mockMarkers[0]} />,
    );

    expect(screen.getByText("Selected Petition")).toBeInTheDocument();
    expect(screen.getByText("doc-1...")).toBeInTheDocument();
    expect(screen.getByText("DOCUMENT ID")).toBeInTheDocument();
    expect(screen.getByText("SCANNED")).toBeInTheDocument();
  });

  it("does not show selected detail when no marker selected", () => {
    render(<PetitionSidebar {...defaultProps} />);

    expect(screen.queryByText("Selected Petition")).not.toBeInTheDocument();
  });

  it("calls onSelect when clicking a petition item", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    render(<PetitionSidebar {...defaultProps} onSelect={onSelect} />);

    const items = screen.getAllByRole("option");
    await user.click(items[0]);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
    );
  });

  it("calls onSelect with null when clicking already-selected item", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    render(
      <PetitionSidebar
        {...defaultProps}
        selectedMarker={mockMarkers[0]}
        onSelect={onSelect}
      />,
    );

    // Find the option for doc-1 and click it
    const items = screen.getAllByRole("option");
    const selectedItem = items.find(
      (item) => item.getAttribute("aria-selected") === "true",
    );
    expect(selectedItem).toBeTruthy();

    await user.click(selectedItem!);

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("handles keyboard selection with Enter", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    render(<PetitionSidebar {...defaultProps} onSelect={onSelect} />);

    const items = screen.getAllByRole("option");
    items[0].focus();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalled();
  });

  it("handles keyboard selection with Space", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    render(<PetitionSidebar {...defaultProps} onSelect={onSelect} />);

    const items = screen.getAllByRole("option");
    items[0].focus();
    await user.keyboard(" ");

    expect(onSelect).toHaveBeenCalled();
  });

  it("shows loading state when loading with no markers", () => {
    render(<PetitionSidebar {...defaultProps} markers={[]} loading={true} />);

    expect(screen.getByText("Loading petitions...")).toBeInTheDocument();
  });

  it("shows empty state when not loading with no markers", () => {
    render(<PetitionSidebar {...defaultProps} markers={[]} loading={false} />);

    expect(
      screen.getByText("No petitions scanned in this area yet"),
    ).toBeInTheDocument();
  });

  it("marks selected item with aria-selected true", () => {
    render(
      <PetitionSidebar {...defaultProps} selectedMarker={mockMarkers[0]} />,
    );

    const items = screen.getAllByRole("option");
    const selectedItems = items.filter(
      (item) => item.getAttribute("aria-selected") === "true",
    );
    expect(selectedItems).toHaveLength(1);
  });
});
