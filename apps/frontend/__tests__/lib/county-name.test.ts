import { findByCountyName, normalizeCountyName } from "@/lib/county-name";

describe("normalizeCountyName", () => {
  it("treats the bare and display names as the same place", () => {
    // The Census geocoder writes "Sonoma"; the region service publishes
    // "Sonoma County". Comparing them raw fails for all 58.
    expect(normalizeCountyName("Sonoma")).toBe(
      normalizeCountyName("Sonoma County"),
    );
  });

  it("ignores case and collapsed whitespace", () => {
    expect(normalizeCountyName("  SAN   JOAQUIN  County ")).toBe("san joaquin");
  });

  it("only strips a trailing County, never one inside the name", () => {
    expect(normalizeCountyName("County Line")).toBe("county line");
  });
});

describe("findByCountyName", () => {
  const counties = [
    { name: "Sonoma County", fips: "06097" },
    { name: "Napa County", fips: "06055" },
  ];

  it("matches across the two spellings", () => {
    expect(findByCountyName(counties, "Sonoma")?.fips).toBe("06097");
    expect(findByCountyName(counties, "Napa County")?.fips).toBe("06055");
  });

  it("returns null rather than guessing", () => {
    // A wrong county here would show the reader someone else's threshold as
    // if it were theirs, which is worse than showing nothing.
    expect(findByCountyName(counties, "Marin")).toBeNull();
    expect(findByCountyName(counties, null)).toBeNull();
    expect(findByCountyName(counties, "")).toBeNull();
  });
});
