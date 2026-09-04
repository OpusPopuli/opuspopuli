import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapModeToggle } from "@/components/landing/MapModeToggle";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "counties.modes.legend": "Show counties by",
        "counties.modes.share": "Share of registered voters",
        "counties.modes.shareHint":
          "How large the requirement is next to the county's electorate.",
        "counties.modes.people": "People",
        "counties.modes.peopleHint":
          "Signatures required, on a logarithmic scale.",
      })[key] ?? key,
  }),
}));

describe("MapModeToggle", () => {
  it("is a labelled radio group, not two buttons", () => {
    // Mutually exclusive options over one question. Native radios give
    // arrow-key traversal, a single tab stop and correct announcement; a
    // button pair with aria-pressed gives none of it.
    render(<MapModeToggle value="share" onChange={jest.fn()} />);

    expect(
      screen.getByRole("group", { name: "Show counties by" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("reflects the selected mode", () => {
    render(<MapModeToggle value="people" onChange={jest.fn()} />);

    expect(screen.getByRole("radio", { name: /People/ })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Share of registered voters/ }),
    ).not.toBeChecked();
  });

  it("reports the mode the user picked", async () => {
    const onChange = jest.fn();
    render(<MapModeToggle value="share" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: /People/ }));

    expect(onChange).toHaveBeenCalledWith("people");
  });

  it("is operable by keyboard alone", async () => {
    const onChange = jest.fn();
    render(<MapModeToggle value="share" onChange={onChange} />);

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: /Share/ })).toHaveFocus();

    // Arrow keys move within a radio group — behaviour we get by using the
    // native control rather than reimplementing it.
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledWith("people");
  });

  it("associates each hint with its option rather than leaving it adjacent", () => {
    // The hint explains why the scale differs. Announced only if associated.
    render(<MapModeToggle value="share" onChange={jest.fn()} />);

    expect(
      screen.getByRole("radio", { name: /Share of registered voters/ }),
    ).toHaveAccessibleDescription(
      "How large the requirement is next to the county's electorate.",
    );
  });

  it("puts every visible string through the catalog", () => {
    // A raw key rendering means the string was inlined or misspelled.
    render(<MapModeToggle value="share" onChange={jest.fn()} />);

    expect(screen.queryByText(/counties\.modes\./)).not.toBeInTheDocument();
  });
});
