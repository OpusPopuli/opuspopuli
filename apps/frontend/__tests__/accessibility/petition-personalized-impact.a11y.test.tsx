/**
 * WCAG 2.2 AA Accessibility Tests for the PersonalizedImpact block (#1052)
 *
 * The block LEADS the petition scan results on the pinned-dark surface, so
 * every state a citizen can see (sign-in nudge, loading, ready) must pass
 * axe on its own. Scope note: jsdom + Tailwind classes means axe verifies
 * STRUCTURE (roles, names, aria wiring, heading order), not computed
 * color contrast — the fixed-token contrast posture (#1047) is enforced
 * by the component's bg-ink/text-paper tokens and the e2e axe scan.
 */

import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import { PersonalizedImpact } from "@/components/petition/PersonalizedImpact";

expect.extend(toHaveNoViolations);

describe("PersonalizedImpact — WCAG 2.2 AA", () => {
  it("sign-in nudge has no axe violations", async () => {
    const { container } = render(
      <PersonalizedImpact status="anonymous" impact={null} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("loading state has no axe violations", async () => {
    const { container } = render(
      <PersonalizedImpact status="loading" impact={null} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ready state has no axe violations", async () => {
    const { container } = render(
      <PersonalizedImpact
        status="ready"
        impact={{
          text: "As a renter, this measure would cap your annual rent increase at 5%.",
          provider: "Ollama",
          model: "qwen3.5:9b",
          promptVersion: "v1",
          fromCache: false,
        }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
