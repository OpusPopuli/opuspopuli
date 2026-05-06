import {
  formatActionTitle,
  formatActionTypeLabel,
  formatActionExcerpt,
  actionTypeAccentClass,
  actionTypeSortKey,
  groupActionsByType,
  groupBillBatches,
} from "@/lib/format-action";
import type { LegislativeAction } from "@/lib/graphql/region";

const baseAction = (
  overrides: Partial<LegislativeAction>,
): LegislativeAction => ({
  id: overrides.id ?? "la-1",
  externalId: overrides.externalId ?? "ext-1",
  body: overrides.body ?? "Assembly",
  date: overrides.date ?? "2026-04-28",
  actionType: overrides.actionType ?? "amendment",
  position: overrides.position,
  text: overrides.text,
  passageStart: overrides.passageStart,
  passageEnd: overrides.passageEnd,
  rawSubject: overrides.rawSubject,
  representativeId: overrides.representativeId,
  propositionId: overrides.propositionId,
  committeeId: overrides.committeeId,
  minutesId: overrides.minutesId ?? "min-1",
  minutesExternalId: overrides.minutesExternalId ?? "meet-1",
});

describe("formatActionTitle", () => {
  it("renders presence:yes with subject", () => {
    expect(
      formatActionTitle(
        baseAction({
          actionType: "presence",
          position: "yes",
          rawSubject: "Smith",
        }),
      ),
    ).toBe("Present — Smith");
  });

  it("renders presence:absent with subject", () => {
    expect(
      formatActionTitle(
        baseAction({
          actionType: "presence",
          position: "absent",
          rawSubject: "Smith",
        }),
      ),
    ).toBe("Absent — Smith");
  });

  it("falls back when no subject", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "presence", position: "yes" }),
      ),
    ).toBe("Present at rollcall");
    expect(
      formatActionTitle(
        baseAction({ actionType: "presence", position: "absent" }),
      ),
    ).toBe("Absent from session");
  });

  it("renders committee_hearing", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "committee_hearing", rawSubject: "Health" }),
      ),
    ).toBe("Hearing: Committee on Health");
  });

  it("renders committee_report", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "committee_report", rawSubject: "AB 1897" }),
      ),
    ).toBe("Committee reported AB 1897");
  });

  it("renders amendment", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "amendment", rawSubject: "AB 500" }),
      ),
    ).toBe("Amendment to AB 500");
  });

  it("renders engrossment + enrollment", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "engrossment", rawSubject: "AB 1" }),
      ),
    ).toBe("AB 1 engrossed");
    expect(
      formatActionTitle(
        baseAction({ actionType: "enrollment", rawSubject: "AB 1" }),
      ),
    ).toBe("AB 1 enrolled");
  });

  it("renders resolution", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "resolution", rawSubject: "ACR 999" }),
      ),
    ).toBe("Introduced ACR 999");
  });

  it("renders V2 vote/speech types", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "vote", rawSubject: "AB 1897" }),
      ),
    ).toBe("Voted on AB 1897");
    expect(formatActionTitle(baseAction({ actionType: "speech" }))).toBe(
      "Floor speech",
    );
  });

  it("falls back to generic shape for unknown action types", () => {
    expect(
      formatActionTitle(
        baseAction({ actionType: "novel_type", rawSubject: "Subj" }),
      ),
    ).toBe("novel_type: Subj");
    expect(formatActionTitle(baseAction({ actionType: "novel_type" }))).toBe(
      "novel_type",
    );
  });

  it("falls back for empty rawSubject on every type", () => {
    expect(
      formatActionTitle(baseAction({ actionType: "committee_hearing" })),
    ).toBe("Committee hearing");
    expect(
      formatActionTitle(baseAction({ actionType: "committee_report" })),
    ).toBe("Committee report");
    expect(formatActionTitle(baseAction({ actionType: "amendment" }))).toBe(
      "Amendment",
    );
    expect(formatActionTitle(baseAction({ actionType: "resolution" }))).toBe(
      "Resolution introduced",
    );
    expect(formatActionTitle(baseAction({ actionType: "vote" }))).toBe(
      "Floor vote",
    );
  });
});

describe("formatActionTypeLabel + actionTypeAccentClass", () => {
  it("returns human labels for known types", () => {
    expect(formatActionTypeLabel("presence")).toBe("Attendance");
    expect(formatActionTypeLabel("committee_hearing")).toBe(
      "Committee hearing",
    );
    expect(formatActionTypeLabel("committee_report")).toBe("Committee report");
  });

  it("falls back to the raw key for unknown types", () => {
    expect(formatActionTypeLabel("totally_new")).toBe("totally_new");
  });

  it("returns a Tailwind class per known type", () => {
    expect(actionTypeAccentClass("amendment")).toMatch(/amber/);
    expect(actionTypeAccentClass("committee_hearing")).toMatch(/blue/);
    expect(actionTypeAccentClass("committee_report")).toMatch(/indigo/);
    expect(actionTypeAccentClass("engrossment")).toMatch(/emerald/);
    expect(actionTypeAccentClass("enrollment")).toMatch(/emerald/);
    expect(actionTypeAccentClass("resolution")).toMatch(/purple/);
    expect(actionTypeAccentClass("presence")).toMatch(/slate/);
    expect(actionTypeAccentClass("unknown")).toMatch(/slate/);
  });
});

describe("formatActionExcerpt", () => {
  it("returns undefined when text is missing or whitespace", () => {
    expect(formatActionExcerpt(baseAction({}))).toBeUndefined();
    expect(formatActionExcerpt(baseAction({ text: "   " }))).toBeUndefined();
  });

  it("collapses whitespace + returns full text under cap", () => {
    expect(
      formatActionExcerpt(baseAction({ text: "Short  passage\n  here" })),
    ).toBe("Short passage here");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "a".repeat(200);
    const excerpt = formatActionExcerpt(baseAction({ text: long }), 50);
    expect(excerpt?.length).toBeLessThanOrEqual(50);
    expect(excerpt?.endsWith("…")).toBe(true);
  });
});

describe("actionTypeSortKey", () => {
  it("orders higher-signal types first", () => {
    expect(actionTypeSortKey("committee_hearing")).toBeLessThan(
      actionTypeSortKey("presence"),
    );
    expect(actionTypeSortKey("amendment")).toBeLessThan(
      actionTypeSortKey("engrossment"),
    );
  });

  it("falls back to a high sort key for unknown types", () => {
    expect(actionTypeSortKey("totally_new")).toBeGreaterThanOrEqual(99);
  });
});

describe("groupActionsByType", () => {
  it("buckets actions by type, preserving within-bucket order", () => {
    const actions = [
      baseAction({ id: "1", actionType: "amendment" }),
      baseAction({ id: "2", actionType: "committee_hearing" }),
      baseAction({ id: "3", actionType: "amendment" }),
      baseAction({ id: "4", actionType: "presence" }),
    ];

    const groups = groupActionsByType(actions);

    expect(groups).toHaveLength(3);
    // Sort: hearing → amendment → presence
    expect(groups[0].actionType).toBe("committee_hearing");
    expect(groups[1].actionType).toBe("amendment");
    expect(groups[2].actionType).toBe("presence");
    // Within-bucket order preserved
    expect(groups[1].items.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("populates a human label per bucket", () => {
    const groups = groupActionsByType([
      baseAction({ actionType: "committee_report" }),
    ]);
    expect(groups[0].label).toBe("Committee report");
  });

  it("returns empty array for empty input", () => {
    expect(groupActionsByType([])).toEqual([]);
  });
});

describe("groupBillBatches", () => {
  it("collapses N consecutive engrossments under same date+verdict", () => {
    const actions = Array.from({ length: 5 }, (_, i) =>
      baseAction({
        id: `eng-${i}`,
        actionType: "engrossment",
        date: "2026-04-28",
        rawSubject: `AB 100${i}`,
        text: `AB 100${i}: Chief Clerk reports engrossed.`,
      }),
    );

    const entries = groupBillBatches(actions, 3);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("batch");
    if (entries[0].type === "batch") {
      expect(entries[0].actions).toHaveLength(5);
      expect(entries[0].verdict).toContain("chief clerk reports engrossed");
    }
  });

  it("does not batch when the run is below threshold", () => {
    const actions = [
      baseAction({
        id: "1",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "AB 1: engrossed.",
      }),
      baseAction({
        id: "2",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "AB 2: engrossed.",
      }),
    ];

    const entries = groupBillBatches(actions, 3);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.type === "single")).toBe(true);
  });

  it("breaks the batch on date change", () => {
    const actions = [
      baseAction({
        id: "1",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "Engrossed.",
      }),
      baseAction({
        id: "2",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "Engrossed.",
      }),
      baseAction({
        id: "3",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "Engrossed.",
      }),
      baseAction({
        id: "4",
        actionType: "engrossment",
        date: "2026-04-27",
        text: "Engrossed.",
      }),
    ];

    const entries = groupBillBatches(actions, 3);
    // First three batched, last one single (only 1 entry on its date).
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("batch");
    expect(entries[1].type).toBe("single");
  });

  it("breaks the batch on verdict change", () => {
    const actions = [
      baseAction({
        id: "1",
        actionType: "committee_report",
        date: "2026-04-28",
        text: "AB 1: Do pass.",
      }),
      baseAction({
        id: "2",
        actionType: "committee_report",
        date: "2026-04-28",
        text: "AB 2: Do pass.",
      }),
      baseAction({
        id: "3",
        actionType: "committee_report",
        date: "2026-04-28",
        text: "AB 3: Do pass.",
      }),
      baseAction({
        id: "4",
        actionType: "committee_report",
        date: "2026-04-28",
        text: "AB 4: Hold.",
      }),
      baseAction({
        id: "5",
        actionType: "committee_report",
        date: "2026-04-28",
        text: "AB 5: Hold.",
      }),
      baseAction({
        id: "6",
        actionType: "committee_report",
        date: "2026-04-28",
        text: "AB 6: Hold.",
      }),
    ];

    const entries = groupBillBatches(actions, 3);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.type === "batch")).toBe(true);
    if (entries[0].type === "batch" && entries[1].type === "batch") {
      expect(entries[0].actions).toHaveLength(3);
      expect(entries[1].actions).toHaveLength(3);
    }
  });

  it("never batches non-batchable types like presence", () => {
    const actions = Array.from({ length: 5 }, (_, i) =>
      baseAction({
        id: `p-${i}`,
        actionType: "presence",
        date: "2026-04-28",
        text: "Present",
      }),
    );

    const entries = groupBillBatches(actions, 3);
    expect(entries.every((e) => e.type === "single")).toBe(true);
  });

  it("preserves order of single entries between batches", () => {
    const actions = [
      baseAction({
        id: "h-1",
        actionType: "committee_hearing",
        date: "2026-04-28",
      }),
      baseAction({
        id: "e-1",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "Engrossed.",
      }),
      baseAction({
        id: "e-2",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "Engrossed.",
      }),
      baseAction({
        id: "e-3",
        actionType: "engrossment",
        date: "2026-04-28",
        text: "Engrossed.",
      }),
      baseAction({
        id: "h-2",
        actionType: "committee_hearing",
        date: "2026-04-28",
      }),
    ];

    const entries = groupBillBatches(actions, 3);
    expect(entries).toHaveLength(3);
    expect(entries[0].type).toBe("single");
    expect(entries[1].type).toBe("batch");
    expect(entries[2].type).toBe("single");
  });

  it("handles missing text without crashing (verdict key falls back)", () => {
    const actions = Array.from({ length: 3 }, (_, i) =>
      baseAction({
        id: `n-${i}`,
        actionType: "engrossment",
        date: "2026-04-28",
        text: undefined,
      }),
    );

    const entries = groupBillBatches(actions, 3);
    expect(entries).toHaveLength(1);
    if (entries[0].type === "batch") {
      expect(entries[0].verdict).toBe("(no recorded verdict)");
    }
  });
});
