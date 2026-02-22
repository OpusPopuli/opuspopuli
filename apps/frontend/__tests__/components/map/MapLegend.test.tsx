import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MapLegend } from "@/components/map/MapLegend";

describe("MapLegend", () => {
  it("renders legend title", () => {
    render(<MapLegend />);

    expect(screen.getByText("Legend")).toBeInTheDocument();
  });

  it("renders petition location indicator", () => {
    render(<MapLegend />);

    expect(screen.getByText("Petition location")).toBeInTheDocument();
  });

  it("renders selected petition indicator", () => {
    render(<MapLegend />);

    expect(screen.getByText("Selected petition")).toBeInTheDocument();
  });

  it("renders cluster indicator", () => {
    render(<MapLegend />);

    expect(screen.getByText("Cluster (count)")).toBeInTheDocument();
  });

  it("renders cluster count example", () => {
    render(<MapLegend />);

    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
