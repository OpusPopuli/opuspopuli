/**
 * WCAG 2.2 AA tests for the non-petition rejection state (#1057) — it
 * replaces the entire analysis surface, so both variants must stand on
 * their own.
 */
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import { NotAPetition } from "@/components/petition/NotAPetition";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("NotAPetition — WCAG 2.2 AA", () => {
  it("not-a-petition variant has no axe violations", async () => {
    const { container } = render(<NotAPetition skipReason="not_a_petition" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("unreadable variant has no axe violations", async () => {
    const { container } = render(<NotAPetition skipReason="unreadable" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
