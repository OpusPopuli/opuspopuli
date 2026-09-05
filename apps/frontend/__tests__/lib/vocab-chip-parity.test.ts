import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_FIELDS } from "@/lib/personalization/vocab";

/**
 * The employment vocabulary lives in TWO hand-maintained copies until #762
 * lands the shared package: `vocab.ts` (the model-of-me edit surface) and the
 * onboarding LifeContext chips. vocab.ts documents the contract — "values
 * must match what the onboarding flow writes" — but until now nothing
 * enforced it, and discipline without a test is hope.
 *
 * The failure this prevents: a value added to one copy but not the other
 * becomes an orphan — settable in profile edit but absent from onboarding
 * (or vice versa), storing rows that one surface can't display or change.
 * That is precisely the drift the launch subset existed to avoid.
 *
 * Reads the component SOURCE rather than rendering it, because the chip
 * options are inline JSX literals — rendering would need the full i18n and
 * Apollo harness to assert a string list. If the inline options ever move to
 * a shared constant (or #762 lands), replace this with a direct import and
 * delete the regex.
 */
describe("employment vocabulary parity", () => {
  const vocabOptions = ALL_FIELDS.find(
    (f) => f.name === "employmentStatus",
  )?.options;

  const chipSource = readFileSync(
    join(__dirname, "../../components/onboarding/LifeContext.tsx"),
    "utf8",
  );

  // Every chip value in the work ChipPicker: { value: "employed", ... }
  const workBlock = chipSource.slice(
    chipSource.indexOf('setKey("workStatus"'),
    chipSource.indexOf('setKey("workExtras"'),
  );
  const chipValues = [...workBlock.matchAll(/value:\s*"([a-z_]+)"/g)].map(
    (m) => m[1],
  );

  it("vocab.ts declares employmentStatus options", () => {
    expect(vocabOptions).toBeDefined();
    expect(vocabOptions!.length).toBeGreaterThan(0);
  });

  it("the onboarding chips offer exactly the vocab.ts options", () => {
    expect([...chipValues].sort()).toEqual([...vocabOptions!].sort());
  });

  it("both surfaces include retired", () => {
    // The value a real user asked for — pinned by name so a refactor that
    // rewrites both lists cannot silently drop it and still pass parity.
    expect(vocabOptions).toContain("retired");
    expect(chipValues).toContain("retired");
  });
  it.each(["en", "es"])(
    "every option has a %s label on both surfaces",
    (lang) => {
      // A value without a label renders as a raw i18n key in the UI —
      // "lifeContext.chips.work.retired" shown to a user is worse than the
      // option being absent.
      const profile = JSON.parse(
        readFileSync(
          join(__dirname, `../../locales/${lang}/profile.json`),
          "utf8",
        ),
      );
      const onboarding = JSON.parse(
        readFileSync(
          join(__dirname, `../../locales/${lang}/onboarding.json`),
          "utf8",
        ),
      );

      const profileLabels =
        profile.fields?.employmentStatus?.options ??
        // fall back to a deep search — the JSON nesting is not load-bearing
        (function find(o) {
          if (o && typeof o === "object") {
            if (o.employmentStatus?.options) return o.employmentStatus.options;
            for (const v of Object.values(o)) {
              const r = find(v);
              if (r) return r;
            }
          }
          return undefined;
        })(profile);
      const chipLabels = onboarding.lifeContext.chips.work;

      for (const opt of vocabOptions!) {
        expect(profileLabels?.[opt]).toBeTruthy();
      }
      for (const value of chipValues) {
        // Chip keys are camelCase (businessOwner) while values are
        // snake_case — normalise before the lookup.
        const key = value.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        expect(chipLabels[key]).toBeTruthy();
      }
    },
  );
});
