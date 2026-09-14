import { DomainMapperService } from "../src/mapping/domain-mapper.service";
import { DataType } from "@opuspopuli/common";

/**
 * #1219. Production, 2026-09-14: the California AG source extracted 46
 * measures, fetched 44 Attorney General summaries successfully, then lost all
 * 46 to `Invalid enum value ... received 'active'`.
 *
 * The manifest asked for a constant `pending`. The generated rule carried
 * `extractionMethod: "text"` with no selector, so the extractor scraped
 * container text from a page titled "Active Measures" and `defaultValue` never
 * applied. That source had been rejecting 100% of its items since August with
 * nobody noticing — a whole-batch rejection is a silent one.
 */
describe("proposition status normalisation (#1219)", () => {
  const mapper = new DomainMapperService();

  const mapOne = (status: unknown) =>
    mapper.map(
      {
        items: [
          {
            externalId: "26-0004",
            title:
              "REPEALS TOP TWO OPEN PRIMARY. INITIATIVE CONSTITUTIONAL AMENDMENT.",
            status,
          } as Record<string, unknown>,
        ],
        warnings: [],
        errors: [],
      } as never,
      {
        url: "https://oag.ca.gov/initiatives/active-measures",
        dataType: DataType.PROPOSITIONS,
      } as never,
    );

  it("accepts 'active' as pending — the value that cost 46 measures", () => {
    const result = mapOne("active");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ status: "pending" });
  });

  it("is case- and whitespace-insensitive, as scraped text is", () => {
    expect(mapOne("  Active  ").items[0]).toMatchObject({ status: "pending" });
  });

  it.each([
    ["circulating", "pending"],
    ["defeated", "failed"],
    ["withdrawn", "withdrawn"],
  ])("maps %s -> %s", (input, expected) => {
    expect(mapOne(input).items[0]).toMatchObject({ status: expected });
  });

  /**
   * Caught by the pre-push AI review before this shipped.
   *
   * A measure that has "qualified for the ballot" has NOT passed — it is
   * awaiting a vote. Mapping it to `passed` would tell a citizen a measure
   * carried when nobody has voted on it. The enum has no on-the-ballot state,
   * so `pending` is the honest approximation.
   */
  it("maps 'qualified' to pending, NOT passed — voters have not voted", () => {
    expect(mapOne("qualified").items[0]).toMatchObject({ status: "pending" });
  });

  /**
   * `passed` is a claim that voters approved a measure. Nothing reaches it by
   * synonym: 'approved' and 'rejected' each mean opposite ends of the
   * lifecycle depending on the source (approved for CIRCULATION vs approved BY
   * VOTERS). A rejected batch is recoverable; a false civic claim is not.
   */
  it.each(["approved", "rejected"])(
    "refuses to guess at the ambiguous status %s",
    (input) => {
      expect(mapOne(input).items).toHaveLength(0);
    },
  );

  it("still accepts the canonical values unchanged", () => {
    expect(mapOne("pending").items[0]).toMatchObject({ status: "pending" });
    expect(mapOne("passed").items[0]).toMatchObject({ status: "passed" });
    expect(mapOne("failed").items[0]).toMatchObject({ status: "failed" });
  });

  it("defaults to pending when the source says nothing", () => {
    expect(mapOne(undefined).items[0]).toMatchObject({ status: "pending" });
  });

  /**
   * Deliberately still a failure. An unrecognised status means the source
   * changed in a way we have not read, and that is real signal — swallowing it
   * would trade one silent failure for another.
   */
  it("REJECTS a genuinely unknown status rather than guessing", () => {
    const result = mapOne("hibernating");

    expect(result.items).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/status/i);
  });
});
