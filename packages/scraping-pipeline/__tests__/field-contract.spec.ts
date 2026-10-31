import { DataType } from "@opuspopuli/common";
import { findFieldContractGaps } from "../src/mapping/field-contract";

describe("findFieldContractGaps", () => {
  it("names both gaps for the Assembly meetings manifest v12 field set", () => {
    // The real field names of manifests v10–v12 (meetings-phase-b.md M1).
    expect(
      findFieldContractGaps(DataType.MEETINGS, [
        "date",
        "time",
        "committeeName",
        "location",
        "agendaUrl",
      ]),
    ).toEqual(["scheduledAt", "title|externalId"]);
  });

  it("accepts a meetings manifest with a title and no externalId", () => {
    // composeMeetingExternalId builds the id from the title.
    expect(
      findFieldContractGaps(DataType.MEETINGS, ["title", "scheduledAt"]),
    ).toEqual([]);
  });

  it("accepts a meetings manifest with an externalId and no title", () => {
    expect(
      findFieldContractGaps(DataType.MEETINGS, ["externalId", "scheduledAt"]),
    ).toEqual([]);
  });

  it("requires both externalId and title for propositions", () => {
    expect(findFieldContractGaps(DataType.PROPOSITIONS, ["title"])).toEqual([
      "externalId",
    ]);
    expect(
      findFieldContractGaps(DataType.PROPOSITIONS, ["externalId", "title"]),
    ).toEqual([]);
  });

  it("requires both externalId and name for representatives", () => {
    expect(
      findFieldContractGaps(DataType.REPRESENTATIVES, ["name", "district"]),
    ).toEqual(["externalId"]);
  });

  it("has no contract for campaign finance, whose records route by key presence", () => {
    expect(
      findFieldContractGaps(DataType.CAMPAIGN_FINANCE, ["anything"]),
    ).toEqual([]);
  });
});
