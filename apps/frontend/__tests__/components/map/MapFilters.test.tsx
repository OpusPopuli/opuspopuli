import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MapFilters } from "@/components/map/MapFilters";

describe("MapFilters", () => {
  const defaultProps = {
    filters: {},
    onUpdateFilters: jest.fn(),
    onNearMe: jest.fn(),
    locationLoading: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders document type select", () => {
    render(<MapFilters {...defaultProps} />);

    expect(
      screen.getByRole("combobox", { name: "Filter by document type" }),
    ).toBeInTheDocument();
  });

  it("renders date inputs", () => {
    render(<MapFilters {...defaultProps} />);

    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("End date")).toBeInTheDocument();
  });

  it("renders Near me button", () => {
    render(<MapFilters {...defaultProps} />);

    expect(
      screen.getByRole("button", { name: "Center map on my location" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Near me")).toBeInTheDocument();
  });

  it("calls onUpdateFilters when document type changes", async () => {
    const user = userEvent.setup();
    const onUpdateFilters = jest.fn();

    render(<MapFilters {...defaultProps} onUpdateFilters={onUpdateFilters} />);

    const select = screen.getByRole("combobox", {
      name: "Filter by document type",
    });
    await user.selectOptions(select, "petition");

    expect(onUpdateFilters).toHaveBeenCalledWith({
      documentType: "petition",
    });
  });

  it("calls onUpdateFilters with undefined when selecting 'All types'", async () => {
    const user = userEvent.setup();
    const onUpdateFilters = jest.fn();

    render(
      <MapFilters
        {...defaultProps}
        filters={{ documentType: "petition" }}
        onUpdateFilters={onUpdateFilters}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Filter by document type",
    });
    await user.selectOptions(select, "");

    expect(onUpdateFilters).toHaveBeenCalledWith({
      documentType: undefined,
    });
  });

  it("calls onUpdateFilters when start date changes", async () => {
    const user = userEvent.setup();
    const onUpdateFilters = jest.fn();

    render(<MapFilters {...defaultProps} onUpdateFilters={onUpdateFilters} />);

    const startDate = screen.getByLabelText("Start date");
    await user.type(startDate, "2024-01-01");

    expect(onUpdateFilters).toHaveBeenCalledWith({
      startDate: expect.any(String),
    });
  });

  it("calls onUpdateFilters when end date changes", async () => {
    const user = userEvent.setup();
    const onUpdateFilters = jest.fn();

    render(<MapFilters {...defaultProps} onUpdateFilters={onUpdateFilters} />);

    const endDate = screen.getByLabelText("End date");
    await user.type(endDate, "2024-12-31");

    expect(onUpdateFilters).toHaveBeenCalledWith({
      endDate: expect.any(String),
    });
  });

  it("calls onNearMe when button is clicked", async () => {
    const user = userEvent.setup();
    const onNearMe = jest.fn();

    render(<MapFilters {...defaultProps} onNearMe={onNearMe} />);

    await user.click(
      screen.getByRole("button", { name: "Center map on my location" }),
    );

    expect(onNearMe).toHaveBeenCalledTimes(1);
  });

  it("shows Locating... text when location is loading", () => {
    render(<MapFilters {...defaultProps} locationLoading={true} />);

    expect(screen.getByText("Locating...")).toBeInTheDocument();
    expect(screen.queryByText("Near me")).not.toBeInTheDocument();
  });

  it("disables Near me button when loading", () => {
    render(<MapFilters {...defaultProps} locationLoading={true} />);

    const button = screen.getByRole("button", {
      name: "Center map on my location",
    });
    expect(button).toBeDisabled();
  });

  it("shows all document type options", () => {
    render(<MapFilters {...defaultProps} />);

    const select = screen.getByRole("combobox", {
      name: "Filter by document type",
    });
    const options = select.querySelectorAll("option");

    expect(options).toHaveLength(5); // All types + 4 specific types
    expect(options[0]).toHaveTextContent("All types");
    expect(options[1]).toHaveTextContent("Petition");
    expect(options[2]).toHaveTextContent("Proposition");
    expect(options[3]).toHaveTextContent("Contract");
    expect(options[4]).toHaveTextContent("Report");
  });

  it("reflects current filter values in inputs", () => {
    render(
      <MapFilters
        {...defaultProps}
        filters={{
          documentType: "proposition",
          startDate: "2024-01-01",
          endDate: "2024-12-31",
        }}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Filter by document type",
    }) as HTMLSelectElement;
    expect(select.value).toBe("proposition");

    const startDate = screen.getByLabelText("Start date") as HTMLInputElement;
    expect(startDate.value).toBe("2024-01-01");

    const endDate = screen.getByLabelText("End date") as HTMLInputElement;
    expect(endDate.value).toBe("2024-12-31");
  });
});
