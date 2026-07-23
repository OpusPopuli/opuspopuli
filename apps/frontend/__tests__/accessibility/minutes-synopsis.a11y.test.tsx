/**
 * WCAG 2.2 AA accessibility tests for the minutes synopsis + claims surface
 * (#932). Covers the presentational pieces (synopsis panel, claim list,
 * concerns badge) that render inside an ActionCard disclosure. The disclosure
 * toggle's expand/collapse semantics are exercised in
 * MinutesDisclosure.test.tsx; this file targets the rendered content for axe.
 */

import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { axe } from "@/__tests__/utils/a11y-utils";
import { MinutesSynopsis } from "@/components/region/MinutesSynopsis";
import { MinutesClaims } from "@/components/region/MinutesClaims";
import { ConcernsBadge } from "@/components/region/ConcernsBadge";
import type { MinutesSummaryClaim } from "@/lib/graphql/region";

const claims: MinutesSummaryClaim[] = [
  {
    kind: "DECISION",
    title: "Voted 5-2 to advance AB 1234",
    detail: "The committee moved the housing bill to appropriations.",
    citation: { quote: "the motion carried 5 to 2", pageHint: "p. 8" },
    billRefs: ["AB 1234"],
  },
  {
    kind: "CONTROVERSY",
    title: "Dispute over fiscal note",
    detail: "Members disagreed on the cost estimate.",
    citation: { quote: "the fiscal note is disputed" },
    billRefs: ["SB 99"],
    severity: "HIGH",
  },
];

describe("Minutes synopsis surface — WCAG 2.2 AA", () => {
  it("synopsis panel has no axe violations", async () => {
    const { container } = render(
      <MinutesSynopsis summary="The committee advanced two bills and heard public comment on housing." />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("claim list has no axe violations", async () => {
    const { container } = render(<MinutesClaims claims={claims} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("concerns badge has no axe violations", async () => {
    const { container } = render(<ConcernsBadge claims={claims} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("claim list empty state has no axe violations", async () => {
    const { container } = render(<MinutesClaims claims={[]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
