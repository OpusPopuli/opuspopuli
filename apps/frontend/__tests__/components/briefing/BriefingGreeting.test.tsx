/**
 * BriefingGreeting (#849 Phase 1) — anchors the top of /me/briefing
 * with a personalized greeting + structured summary.
 *
 * Covers:
 *  - time-of-day branch selection
 *  - first-name personalization + no-name fallback
 *  - Spanish drops the address-word when no name is shared (gender)
 *  - "Citizen" NEVER appears in the EN greeting (immigration concern)
 *  - count assembly + pluralization for the urgent callout
 *  - copy is descriptive, NOT persuasive (commitment 4 guardrail)
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
  BriefingGreeting,
  type BriefingCounts,
} from "@/components/briefing/BriefingGreeting";
import i18n from "@/lib/i18n";

const counts: BriefingCounts = {
  bills: 5,
  reps: 3,
  committees: 2,
  propositions: 1,
};

describe("BriefingGreeting", () => {
  afterEach(async () => {
    // Reset language between tests so the ES suite doesn't leak.
    await i18n.changeLanguage("en");
  });

  describe("greeting line", () => {
    it("renders 'Good morning, {firstName}' when name + morning hour", () => {
      render(
        <BriefingGreeting firstName="Rodney" counts={counts} nowHour={9} />,
      );
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: /good morning, rodney/i,
        }),
      ).toBeInTheDocument();
    });

    it("renders 'Good afternoon, {firstName}' at 14:00", () => {
      render(
        <BriefingGreeting firstName="Rodney" counts={counts} nowHour={14} />,
      );
      expect(
        screen.getByRole("heading", { name: /good afternoon, rodney/i }),
      ).toBeInTheDocument();
    });

    it("renders 'Good evening, {firstName}' at 20:00", () => {
      render(
        <BriefingGreeting firstName="Rodney" counts={counts} nowHour={20} />,
      );
      expect(
        screen.getByRole("heading", { name: /good evening, rodney/i }),
      ).toBeInTheDocument();
    });

    it("falls back to 'Good morning, neighbor' when firstName is null (EN)", () => {
      render(<BriefingGreeting firstName={null} counts={counts} nowHour={9} />);
      expect(
        screen.getByRole("heading", { name: /good morning, neighbor/i }),
      ).toBeInTheDocument();
    });

    it("treats whitespace-only firstName as no name", () => {
      render(<BriefingGreeting firstName="   " counts={counts} nowHour={9} />);
      expect(
        screen.getByRole("heading", { name: /good morning, neighbor/i }),
      ).toBeInTheDocument();
    });

    it("never uses the word 'citizen' in the EN no-name branch (immigration concern, commitment 8)", () => {
      const { container } = render(
        <BriefingGreeting firstName={null} counts={counts} nowHour={14} />,
      );
      expect(container.textContent?.toLowerCase()).not.toContain("citizen");
    });
  });

  describe("Spanish localization", () => {
    beforeEach(async () => {
      await i18n.changeLanguage("es");
    });

    it("uses time-only phrase ('Buenos días') when no name is shared (avoids vecino/vecina gender)", () => {
      render(<BriefingGreeting firstName={null} counts={counts} nowHour={9} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toMatch(/buenos días/i);
      // The gendered address words must never surface in the no-name
      // branch — that's the whole point of the time-only fallback.
      expect(heading.textContent?.toLowerCase()).not.toMatch(/vecin[oa]/);
    });

    it("includes firstName when one is supplied (ES)", () => {
      render(
        <BriefingGreeting firstName="Rodney" counts={counts} nowHour={9} />,
      );
      expect(
        screen.getByRole("heading", { name: /buenos días, rodney/i }),
      ).toBeInTheDocument();
    });
  });

  describe("summary line", () => {
    it("renders counts of every section", () => {
      render(
        <BriefingGreeting
          firstName={null}
          counts={{ bills: 7, reps: 4, committees: 3, propositions: 2 }}
          nowHour={10}
        />,
      );
      const heading = screen.getByRole("heading", { level: 1 });
      // The summary lives directly under the heading; find it via the
      // section's accessible name + content.
      const region = heading.closest("section")!;
      expect(region.textContent).toMatch(/7/);
      expect(region.textContent).toMatch(/4/);
      expect(region.textContent).toMatch(/3/);
      expect(region.textContent).toMatch(/2/);
    });

    it("renders zero counts without crashing (empty briefing edge case)", () => {
      render(
        <BriefingGreeting
          firstName={null}
          counts={{ bills: 0, reps: 0, committees: 0, propositions: 0 }}
          nowHour={10}
        />,
      );
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
  });

  describe("urgent callout", () => {
    it("renders the singular form when exactly one bill is urgent", () => {
      render(
        <BriefingGreeting
          firstName={null}
          counts={counts}
          urgentBillCount={1}
          nowHour={10}
        />,
      );
      // Singular: "1 ... has action"
      expect(screen.getByText(/1.*has action/i)).toBeInTheDocument();
    });

    it("renders the plural form when multiple bills are urgent", () => {
      render(
        <BriefingGreeting
          firstName={null}
          counts={counts}
          urgentBillCount={3}
          nowHour={10}
        />,
      );
      expect(screen.getByText(/3.*have action/i)).toBeInTheDocument();
    });

    it("hides the callout entirely when urgentBillCount is 0", () => {
      render(
        <BriefingGreeting
          firstName={null}
          counts={counts}
          urgentBillCount={0}
          nowHour={10}
        />,
      );
      expect(
        screen.queryByText(/action you can influence/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("commitment-4 guardrail (no persuasive copy)", () => {
    // Per §10 commitment 4, the platform must never persuade. The
    // greeting copy is hand-authored, but this regex check catches
    // regressions if a future i18n contributor reaches for persuasive
    // verbs without realizing the constraint.
    const FORBIDDEN_PHRASES = [
      /should care/i,
      /you must/i,
      /critical for you/i,
      /vote for/i,
      /support this/i,
      /oppose this/i,
      /you deserve to know/i,
    ];

    it.each(FORBIDDEN_PHRASES)(
      "rendered text does not contain %p",
      (phrase) => {
        const { container } = render(
          <BriefingGreeting
            firstName="Rodney"
            counts={counts}
            urgentBillCount={2}
            nowHour={9}
          />,
        );
        expect(container.textContent ?? "").not.toMatch(phrase);
      },
    );
  });
});
