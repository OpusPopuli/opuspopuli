import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The civic record without an account (#1456).
 *
 * No auth session is set up anywhere in this file. Every test also checks
 * the requests the page sent: a signed-out page must never ask for an
 * account-only field, because the 401 would start a session refresh and,
 * for a returning reader with a stale session, a redirect to /login.
 */

/** Root fields the server guards that a region page could plausibly ask for. */
const ACCOUNT_ONLY = [
  "myJurisdictions",
  "myCountySupervisors",
  "myAddresses",
  "myProfile",
  "mySignalProfile",
  "myRankingFlags",
  "myBriefingSummary",
  "personalizedImpact",
  "contactRepresentative",
  "representativeMailtoLink",
  "recordEvent",
  "updateMyProfile",
];

const COUNTY_ID = "8cc8fa26-7e97-42fa-b5eb-894a8801fff6";
const ASSEMBLY_ID = "6cdad604-cda5-41a5-8941-4b7d9e42e478";

const JURISDICTIONS = [
  {
    id: COUNTY_ID,
    fipsCode: "06097",
    ocdId: null,
    name: "Sonoma County",
    type: "COUNTY",
    level: "COUNTY",
    stateCode: "CA",
    parent: null,
  },
  {
    id: ASSEMBLY_ID,
    fipsCode: null,
    ocdId: null,
    name: "California State Assembly District 2",
    type: "STATE_ASSEMBLY_DISTRICT",
    level: "STATE",
    stateCode: "CA",
    parent: { id: "ca", name: "California", type: "STATE", level: "STATE" },
  },
];

const PROPOSITION = {
  id: "1",
  externalId: "prop-1",
  title: "Proposition 1: Test Measure",
  summary: "This is a test proposition summary.",
  status: "PENDING",
  electionDate: "2024-11-05T00:00:00Z",
  sourceUrl: "https://example.com/prop-1",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const ANSWERS: Array<[RegExp, () => unknown]> = [
  [/locateJurisdictions/, () => ({ locateJurisdictions: JURISDICTIONS })],
  [/jurisdictionsByIds/, () => ({ jurisdictionsByIds: JURISDICTIONS })],
  [/countySupervisorsAt/, () => ({ countySupervisorsAt: [] })],
  [/representativesByDistricts/, () => ({ representativesByDistricts: [] })],
  [/bills\(/, () => ({ bills: { items: [], total: 0, hasMore: false } })],
  [/countyThresholds/, () => ({ countyThresholds: [] })],
  [/regionInfo/, () => ({ regionInfo: null })],
  [
    /petitionDocumentsForProposition/,
    () => ({ petitionDocumentsForProposition: [] }),
  ],
  [/proposition[\s(]/, () => ({ proposition: PROPOSITION })],
];

interface Sent {
  readonly operationName?: string;
  readonly query: string;
}

/** Mock the API, and keep every operation the page sent. */
async function mockApi(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/api", async (route) => {
    const request = route.request();
    const body =
      request.method() === "POST"
        ? (request.postDataJSON() as Sent | null)
        : null;
    if (body?.query) sent.push(body);
    const match = ANSWERS.find(([pattern]) => pattern.test(body?.query ?? ""));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: match ? match[1]() : {} }),
    });
  });
  return sent;
}

/** The account-only fields any sent operation asked for. */
function accountOnlyFieldsIn(sent: readonly Sent[]): string[] {
  return ACCOUNT_ONLY.filter((field) =>
    sent.some(({ query }) => new RegExp(`\\b${field}\\b`).test(query)),
  );
}

test.describe("Region without an account (#1456)", () => {
  let sent: Sent[];

  test.beforeEach(async ({ page }) => {
    sent = await mockApi(page);
  });

  test.afterEach(() => {
    expect(accountOnlyFieldsIn(sent)).toEqual([]);
  });

  test("opens the region instead of sending the visitor to sign in", async ({
    page,
  }) => {
    await page.goto("/region");
    await expect(page).toHaveURL(/\/region$/);
    await expect(
      page.getByRole("heading", { name: "Find your districts" }),
    ).toBeVisible();
  });

  test("finds districts from an address, keeps only their ids, and forgets them on request", async ({
    page,
  }) => {
    await page.goto("/region");
    await page.getByLabel("Street address").fill("1315 10th St");
    await page.getByLabel("City").fill("Sacramento");
    await page.getByLabel("ZIP code").fill("95814");
    await page.getByRole("button", { name: "Find my districts" }).click();

    await expect(page.getByText("Sonoma County")).toBeVisible();
    const stored = await page.evaluate(() =>
      localStorage.getItem("op-visitor-jurisdictions-v1"),
    );
    expect(JSON.parse(stored ?? "[]")).toEqual([COUNTY_ID, ASSEMBLY_ID]);
    // The address went out once, in a POST body, and was never written down.
    const everything = await page.evaluate(() =>
      JSON.stringify({ ...localStorage }),
    );
    expect(everything).not.toContain("1315 10th St");

    // A returning visitor gets the same districts back from the ids.
    await page.reload();
    await expect(page.getByText("Sonoma County")).toBeVisible();

    await page.getByRole("button", { name: "Clear location" }).click();
    await expect(
      page.getByRole("heading", { name: "Find your districts" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("op-visitor-jurisdictions-v1"),
      ),
    ).toBeNull();
    // Nothing derived from the location survives in the persisted Apollo
    // cache either: no districts, no legislators looked up by them.
    const cached = await page.evaluate(() =>
      JSON.stringify({ ...localStorage }),
    );
    for (const field of [
      "representativesByDistricts(",
      "jurisdictionsByIds(",
      "countySupervisorsAt(",
      "locateJurisdictions(",
    ]) {
      expect(cached).not.toContain(field);
    }
  });

  test("invites an account on a proposition, without blocking it", async ({
    page,
  }) => {
    await page.goto("/region/propositions/1");
    await expect(
      page.getByRole("heading", { name: /Proposition 1: Test Measure/ }),
    ).toBeVisible();
    const prompt = page.getByRole("complementary", {
      name: "What does this mean for you?",
    });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Not now" }).click();
    await expect(prompt).toBeHidden();
  });

  test("offers the way in from the header", async ({ page }) => {
    await page.goto("/region");
    const header = page.locator("header").first();
    await expect(
      header.getByRole("link", { name: "Explore" }).first(),
    ).toHaveAttribute("href", "/region");
    await expect(
      header.getByRole("link", { name: "Create account" }).first(),
    ).toHaveAttribute("href", "/register");
  });

  test("is accessible signed out", async ({ page }) => {
    await page.goto("/region");
    await expect(
      page.getByRole("heading", { name: "Find your districts" }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
