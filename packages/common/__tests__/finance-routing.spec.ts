import {
  emptyCampaignFinanceResult,
  sortCampaignFinanceItems,
} from "../src/providers/region/finance-routing.js";

/**
 * These rules decide which table every CAL-ACCESS row lands in, from field
 * presence alone — the bulk downloads carry no type tag. A row matching no rule
 * is dropped, and a row matching the wrong rule is counted against the wrong
 * committee, so the overlaps are what these tests pin down.
 */
describe("sortCampaignFinanceItems", () => {
  const summary = () => ({
    externalId: "2505994:1:F460:1",
    filingId: "2505994",
    amendId: 1,
    formType: "F460",
    lineItem: "1",
    amountA: 170988.25,
    sourceSystem: "cal_access",
  });

  it("routes a SMRY_CD row to filingSummaries (#992)", () => {
    const out = sortCampaignFinanceItems([summary()]);

    expect(out.filingSummaries).toHaveLength(1);
    expect(out.filingSummaries[0]).toMatchObject({ lineItem: "1" });
  });

  it("does not let a summary row fall through to contributions (#992)", () => {
    // Contributions is where a row with an amount lands by default, and a
    // summary counted as a contribution would inflate the very total this
    // table exists to check.
    const out = sortCampaignFinanceItems([summary()]);

    expect(out.contributions).toHaveLength(0);
    expect(out.expenditures).toHaveLength(0);
    expect(out.committees).toHaveLength(0);
    expect(out.cvrFilings).toHaveLength(0);
  });

  it("routes each finance shape to its own table", () => {
    const out = sortCampaignFinanceItems([
      summary(),
      { externalId: "c1", donorName: "Jane", amount: 100 },
      { externalId: "e1", payeeName: "Ad Agency", amount: 900 },
      { externalId: "ie1", committeeName: "PAC-1", supportOrOppose: "S" },
      { externalId: "f1", filerId: "C1", filingId: "F1" },
      { externalId: "m1", filingId: "F2", ballotNumber: "Prop 5" },
      { externalId: "k1", sourceSystem: "fec", type: "pac" },
    ]);

    expect(out.filingSummaries).toHaveLength(1);
    expect(out.contributions).toHaveLength(1);
    expect(out.expenditures).toHaveLength(1);
    expect(out.independentExpenditures).toHaveLength(1);
    expect(out.cvrFilings).toHaveLength(1);
    expect(out.committeeMeasureFilings).toHaveLength(1);
    expect(out.committees).toHaveLength(1);
  });

  it("prefers the cover page over the measure filing when both could match (#955)", () => {
    // A cover page carries filingId and could be read as a measure filing if
    // it also carries a ballot field. filerId is what distinguishes it, and
    // the cover-page rule has to come first for that to hold.
    const out = sortCampaignFinanceItems([
      {
        externalId: "f1",
        filerId: "C1",
        filingId: "F1",
        ballotName: "Clean Water Act",
      },
    ]);

    expect(out.cvrFilings).toHaveLength(1);
    expect(out.committeeMeasureFilings).toHaveLength(0);
  });

  it("prefers the measure filing over the committee when both could match (#936)", () => {
    // CVR2 rows carry a sourceSystem too, so the looser committee rule must
    // not get to them first.
    const out = sortCampaignFinanceItems([
      {
        externalId: "m1",
        filingId: "F2",
        ballotNumber: "Prop 5",
        sourceSystem: "cal_access",
        type: "candidate",
      },
    ]);

    expect(out.committeeMeasureFilings).toHaveLength(1);
    expect(out.committees).toHaveLength(0);
  });

  it("drops a record no rule claims", () => {
    const out = sortCampaignFinanceItems([
      { externalId: "x1", nonsense: true },
    ]);

    expect(Object.values(out).every((bucket) => bucket.length === 0)).toBe(
      true,
    );
  });

  it("returns every bucket even for an empty stream, so callers can push blind", () => {
    expect(sortCampaignFinanceItems([])).toEqual(emptyCampaignFinanceResult());
    expect(Object.keys(emptyCampaignFinanceResult()).sort()).toEqual([
      "committeeMeasureFilings",
      "committees",
      "contributions",
      "cvrFilings",
      "expenditures",
      "filingSummaries",
      "independentExpenditures",
    ]);
  });
});
