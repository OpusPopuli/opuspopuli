import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { LayerButton } from "@/components/region/LayerButton";

describe("LayerButton", () => {
  it("renders children", () => {
    render(<LayerButton onClick={() => {}}>Learn More</LayerButton>);
    expect(
      screen.getByRole("button", { name: "Learn More" }),
    ).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<LayerButton onClick={onClick}>Next</LayerButton>);

    await user.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies primary styling by default", () => {
    render(<LayerButton onClick={() => {}}>Primary</LayerButton>);

    expect(screen.getByRole("button")).toHaveClass("bg-gray-900");
  });

  it("applies secondary styling when variant='secondary'", () => {
    render(
      <LayerButton variant="secondary" onClick={() => {}}>
        Secondary
      </LayerButton>,
    );

    expect(screen.getByRole("button")).toHaveClass("bg-white");
  });
});
