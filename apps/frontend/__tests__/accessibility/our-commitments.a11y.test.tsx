/**
 * WCAG 2.2 AA accessibility for /our-commitments (#754).
 *
 * The page is content-only (no interactive widgets beyond standard
 * links + a print affordance) so this run is a single static-state
 * axe sweep. Onboarding-step accessibility lives in the dedicated
 * CommitmentsStep a11y test below.
 */
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import OurCommitmentsPage from "@/app/our-commitments/page";

expect.extend(toHaveNoViolations);

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...rest
  }: React.PropsWithChildren<{
    href: string;
  }>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock("@/components/Header", () => ({ Header: () => <header /> }));
jest.mock("@/components/Footer", () => ({ Footer: () => <footer /> }));

describe("/our-commitments — WCAG 2.2 AA", () => {
  it("renders with no axe violations", async () => {
    const { container } = render(<OurCommitmentsPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
