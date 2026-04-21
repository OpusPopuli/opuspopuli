import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { LayerNav } from "@/components/region/LayerNav";

const LAYERS = [
  { n: 1, label: "Quick View" },
  { n: 2, label: "Details" },
  { n: 3, label: "Deep Dive" },
] as const;

describe("LayerNav", () => {
  it("renders all provided layer labels", () => {
    render(<LayerNav layers={LAYERS} current={1} onChange={() => {}} />);

    expect(
      screen.getByRole("button", { name: "Quick View" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deep Dive" }),
    ).toBeInTheDocument();
  });

  it("marks the current layer with aria-current=step", () => {
    render(<LayerNav layers={LAYERS} current={2} onChange={() => {}} />);

    const current = screen.getByRole("button", { name: "Details" });
    expect(current).toHaveAttribute("aria-current", "step");

    const other = screen.getByRole("button", { name: "Quick View" });
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("calls onChange with the clicked layer number", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<LayerNav layers={LAYERS} current={1} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Deep Dive" }));

    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("renders an accessible nav landmark", () => {
    render(<LayerNav layers={LAYERS} current={1} onChange={() => {}} />);

    expect(
      screen.getByRole("navigation", { name: /Information depth/i }),
    ).toBeInTheDocument();
  });

  it("works with arbitrary layer counts (not hardcoded to 4)", () => {
    const twoLayers = [
      { n: 1, label: "Summary" },
      { n: 2, label: "All Data" },
    ] as const;
    render(<LayerNav layers={twoLayers} current={1} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Summary" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All Data" }),
    ).toBeInTheDocument();
  });
});
