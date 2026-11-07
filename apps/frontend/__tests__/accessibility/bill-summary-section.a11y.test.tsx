/**
 * WCAG 2.2 AA for the bill summary section (bills-phase-b.md D7). Each state
 * a reader can see must pass axe on its own. jsdom checks structure (roles,
 * names, live region), not computed contrast.
 */
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";
import { BillSummarySection } from "@/components/region/BillSummarySection";

expect.extend(toHaveNoViolations);

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));
jest.mock("@apollo/client/react", () => ({
  useMutation: () => [jest.fn(), { loading: false }],
  useApolloClient: () => ({ query: jest.fn() }),
  useQuery: () => ({ data: undefined }),
}));

describe("BillSummarySection — WCAG 2.2 AA", () => {
  it.each([
    ["missing, with the request button", "MISSING", false],
    ["stale, with the update button", "STALE", true],
    ["pending", "PENDING", false],
    ["unavailable", "UNAVAILABLE", false],
    ["current", "CURRENT", true],
  ] as const)(
    "%s has no axe violations",
    async (_label, status, hasSummary) => {
      const { container } = render(
        <BillSummarySection billId="b1" status={status} hasSummary={hasSummary}>
          {hasSummary && (
            <section aria-label="Plain-English summary">
              <p>A summary.</p>
            </section>
          )}
        </BillSummarySection>,
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
