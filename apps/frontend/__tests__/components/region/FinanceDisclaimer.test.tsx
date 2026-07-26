import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FinanceDisclaimer } from "@/components/region/FinanceDisclaimer";

describe("FinanceDisclaimer (#962)", () => {
  it("names the official public records as the data source", () => {
    render(<FinanceDisclaimer />);
    expect(screen.getByText(/official public records/i)).toBeInTheDocument();
    expect(
      screen.getByText(/CAL-ACCESS.*Federal Election Commission/i),
    ).toBeInTheDocument();
  });

  it("states attributions are automated and NOT an allegation, and to verify", () => {
    render(<FinanceDisclaimer />);
    expect(
      screen.getByText(/not an allegation of wrongdoing/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/verify against the official filings/i),
    ).toBeInTheDocument();
  });

  it("exposes an accessible note label (not a nested landmark)", () => {
    render(<FinanceDisclaimer />);
    expect(
      screen.getByRole("note", {
        name: /campaign-finance data disclaimer/i,
      }),
    ).toBeInTheDocument();
  });
});
