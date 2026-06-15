/**
 * WCAG 2.2 AA sweep for `BriefingGreeting` (#849 Phase 1). Three
 * states matter: named user, no-name fallback, and empty briefing
 * (zero counts, no urgent callout). The component is content-only —
 * no interactive widgets — so this is a single static-state pass per
 * variant.
 */
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import { BriefingGreeting } from "@/components/briefing/BriefingGreeting";

expect.extend(toHaveNoViolations);

describe("BriefingGreeting — WCAG 2.2 AA", () => {
  it("named-user state has no axe violations", async () => {
    const { container } = render(
      <BriefingGreeting
        firstName="Rodney"
        counts={{ bills: 5, reps: 3, committees: 2, propositions: 1 }}
        urgentBillCount={2}
        nowHour={9}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("no-name fallback (EN: 'Hello, neighbor') has no axe violations", async () => {
    const { container } = render(
      <BriefingGreeting
        firstName={null}
        counts={{ bills: 5, reps: 3, committees: 2, propositions: 1 }}
        urgentBillCount={1}
        nowHour={14}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("empty briefing (zero counts, no urgency) has no axe violations", async () => {
    const { container } = render(
      <BriefingGreeting
        firstName={null}
        counts={{ bills: 0, reps: 0, committees: 0, propositions: 0 }}
        urgentBillCount={0}
        nowHour={20}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
