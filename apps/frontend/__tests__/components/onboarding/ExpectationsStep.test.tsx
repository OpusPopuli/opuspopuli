import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ExpectationsStep } from "@/components/onboarding/steps/ExpectationsStep";
import en from "@/locales/en/onboarding.json";

describe("ExpectationsStep", () => {
  it("says plainly which capabilities are not built yet", () => {
    // The four slides this replaces advertised everything in the present
    // tense, including work still in progress. A reader who finds the gap
    // later, by its absence, reads it as a broken product.
    render(<ExpectationsStep onComplete={() => {}} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(6);

    const building = items.filter((li) =>
      within(li).queryByText(en.expectations.readiness.building),
    );
    expect(building).toHaveLength(2);
    expect(building[0]).toHaveTextContent(
      en.expectations.items.countyMeasures.title,
    );
  });

  it("carries readiness as text, not as colour alone", () => {
    // "Still being built" is the most decision-relevant thing on this screen,
    // so it cannot be conveyed by hue alone (WCAG 1.4.1).
    render(<ExpectationsStep onComplete={() => {}} />);
    expect(screen.getAllByText(en.expectations.readiness.live)).toHaveLength(4);
  });

  it("states when notifications arrive, and when they do not", () => {
    render(<ExpectationsStep onComplete={() => {}} />);
    expect(
      screen.getByText(en.expectations.notifyLead, { exact: false }),
    ).toBeInTheDocument();
  });

  it("advances on continue", async () => {
    const onComplete = jest.fn();
    const user = userEvent.setup();
    render(<ExpectationsStep onComplete={onComplete} />);
    await user.click(screen.getByRole("button", { name: en.continue }));
    expect(onComplete).toHaveBeenCalled();
  });
});
