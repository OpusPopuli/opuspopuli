import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const mockAnalysis = {
  documentType: "petition",
  summary: "This petition aims to reform criminal sentencing guidelines.",
  keyPoints: ["Reduces felonies to misdemeanors", "Retroactive application"],
  entities: ["California", "Department of Justice"],
  analyzedAt: new Date().toISOString(),
  provider: "Ollama",
  model: "llama3.2",
  processingTimeMs: 1500,
  promptVersion: "v2",
  promptHash: "abc12345",
  sources: [],
  completenessScore: 80,
  completenessDetails: {
    availableCount: 4,
    idealCount: 5,
    missingItems: ["Financial impact data"],
    explanation: "Based on 4 of 5 sources.",
  },
  relatedMeasures: ["Proposition 47"],
  actualEffect: "Reclassifies certain offenses",
  potentialConcerns: [],
  beneficiaries: [],
  potentiallyHarmed: [],
};

const mockLinkedPropositions = [
  {
    id: "link-1",
    propositionId: "prop-1",
    title: "Proposition 47: Criminal Sentencing",
    summary: "Reform criminal sentencing guidelines",
    status: "PENDING",
    electionDate: "2024-11-05T00:00:00Z",
    linkSource: "auto_analysis",
    confidence: 0.8,
    matchedText: "Proposition 47",
    linkedAt: new Date().toISOString(),
  },
];

const mockPetitionDocuments = [
  {
    id: "link-1",
    documentId: "doc-1",
    summary: "This petition aims to reform criminal sentencing guidelines.",
    linkSource: "auto_analysis",
    confidence: 0.8,
    linkedAt: new Date().toISOString(),
  },
];

const mockSearchResults = [
  {
    id: "prop-2",
    title: "Proposition 36: Three Strikes Reform",
    externalId: "Prop 36",
    status: "PENDING",
  },
];

async function mockPetitionResultsGraphQL(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        id: "test-user-id",
        email: "test@example.com",
        roles: ["user"],
      }),
    );

    // Set up petition scan data so the results page doesn't redirect
    sessionStorage.setItem("petition-scan-data", "fakebase64data");
  });

  await page.route("**/api", async (route) => {
    const postData = route.request().postDataJSON();

    if (postData?.query?.includes("ProcessScan")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            processScan: {
              documentId: "doc-1",
              text: "Sample petition text",
              confidence: 95,
              provider: "tesseract",
              processingTimeMs: 200,
            },
          },
        }),
      });
    } else if (postData?.query?.includes("AnalyzeDocument")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            analyzeDocument: {
              analysis: mockAnalysis,
              fromCache: false,
            },
          },
        }),
      });
    } else if (postData?.query?.includes("SetDocumentLocation")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            setDocumentLocation: {
              success: true,
              fuzzedLocation: { latitude: 37.77, longitude: -122.42 },
            },
          },
        }),
      });
    } else if (postData?.query?.includes("linkedPropositions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { linkedPropositions: mockLinkedPropositions },
        }),
      });
    } else if (postData?.query?.includes("SearchPropositions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { searchPropositions: mockSearchResults },
        }),
      });
    } else if (postData?.query?.includes("LinkDocumentToProposition")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            linkDocumentToProposition: { success: true, linkId: "link-2" },
          },
        }),
      });
    } else {
      await route.continue();
    }
  });
}

async function mockPropositionDetailGraphQL(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        id: "test-user-id",
        email: "test@example.com",
        roles: ["user"],
      }),
    );
  });

  await page.route("**/api", async (route) => {
    const postData = route.request().postDataJSON();

    if (
      postData?.query?.includes("proposition(") ||
      postData?.query?.includes("proposition (")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            proposition: {
              id: "prop-1",
              externalId: "Prop 47",
              title: "Proposition 47: Criminal Sentencing",
              summary: "Reform criminal sentencing guidelines",
              status: "PENDING",
              electionDate: "2024-11-05T00:00:00Z",
              sourceUrl: "https://example.com/prop-47",
              fullText: "Full text of proposition 47...",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          },
        }),
      });
    } else if (postData?.query?.includes("petitionDocumentsForProposition")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            petitionDocumentsForProposition: mockPetitionDocuments,
          },
        }),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe("Petition-Ballot Linking", () => {
  test.describe("Petition Results Page", () => {
    test("should show linked propositions as clickable cards", async ({
      page,
    }) => {
      await mockPetitionResultsGraphQL(page);
      await page.goto("/petition/results");

      // Wait for the linked proposition card to appear (after full pipeline)
      const propCard = page.getByRole("link", {
        name: /Proposition 47/i,
      });
      await expect(propCard).toBeVisible({ timeout: 15000 });

      // Verify it links to the proposition detail page
      await expect(propCard).toHaveAttribute(
        "href",
        "/region/propositions/prop-1",
      );

      // Check link source badge
      await expect(page.getByText("AI-matched")).toBeVisible();
    });

    test("should show Track on Ballot button with linked count", async ({
      page,
    }) => {
      await mockPetitionResultsGraphQL(page);
      await page.goto("/petition/results");

      // Should show tracking count once linked propositions load
      await expect(page.getByText(/Tracking 1 measure/i)).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test.describe("Proposition Detail Page", () => {
    test("should show linked petition scans in Details layer", async ({
      page,
    }) => {
      await mockPropositionDetailGraphQL(page);
      await page.goto("/region/propositions/prop-1");

      // Navigate to Details layer
      await page.getByRole("button", { name: "Details" }).click();

      // Check petition scan section appears
      await expect(page.getByText("Community Petition Scans")).toBeVisible();

      // Check petition document summary
      await expect(
        page.getByText("This petition aims to reform criminal sentencing"),
      ).toBeVisible();

      // Check link source badge
      await expect(page.getByText("AI-matched")).toBeVisible();
    });

    test("should show empty state when no petition scans linked", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            id: "test-user-id",
            email: "test@example.com",
            roles: ["user"],
          }),
        );
      });

      await page.route("**/api", async (route) => {
        const postData = route.request().postDataJSON();

        if (
          postData?.query?.includes("proposition(") ||
          postData?.query?.includes("proposition (")
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                proposition: {
                  id: "prop-2",
                  externalId: "Prop 36",
                  title: "Proposition 36",
                  summary: "Three strikes reform",
                  status: "PENDING",
                  electionDate: null,
                  sourceUrl: null,
                  fullText: null,
                  createdAt: "2024-01-01T00:00:00Z",
                  updatedAt: "2024-01-01T00:00:00Z",
                },
              },
            }),
          });
        } else if (
          postData?.query?.includes("petitionDocumentsForProposition")
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: { petitionDocumentsForProposition: [] },
            }),
          });
        } else {
          await route.continue();
        }
      });

      await page.goto("/region/propositions/prop-2");
      await page.getByRole("button", { name: "Details" }).click();

      await expect(
        page.getByText("Petition scans related to this measure"),
      ).toBeVisible();
    });
  });

  test.describe("Track on Ballot Search & Link Flow", () => {
    test("should open search dropdown and display results", async ({
      page,
    }) => {
      await mockPetitionResultsGraphQL(page);
      await page.goto("/petition/results");

      // Wait for linked propositions to load, then click tracking button
      const trackButton = page.getByText(/Tracking 1 measure/i);
      await expect(trackButton).toBeVisible({ timeout: 15000 });
      await trackButton.click();

      // Search input should appear
      const searchInput = page.getByPlaceholder(/Search ballot measures/i);
      await expect(searchInput).toBeVisible();

      // Type a search query
      await searchInput.fill("Proposition");

      // Wait for search results to appear
      await expect(
        page.getByText("Proposition 36: Three Strikes Reform"),
      ).toBeVisible({ timeout: 5000 });
    });

    test("should link a proposition via search and close dropdown", async ({
      page,
    }) => {
      await mockPetitionResultsGraphQL(page);
      await page.goto("/petition/results");

      // Wait for linked propositions to load, then open dropdown
      const trackButton = page.getByText(/Tracking 1 measure/i);
      await expect(trackButton).toBeVisible({ timeout: 15000 });
      await trackButton.click();

      // Search and select
      const searchInput = page.getByPlaceholder(/Search ballot measures/i);
      await searchInput.fill("Proposition");

      await expect(
        page.getByText("Proposition 36: Three Strikes Reform"),
      ).toBeVisible({ timeout: 5000 });

      // Click to link
      await page.getByText("Proposition 36: Three Strikes Reform").click();

      // Dropdown should close after linking
      await expect(searchInput).not.toBeVisible({ timeout: 3000 });
    });

    test("should show no linked propositions with unmatched measures as text", async ({
      page,
    }) => {
      // Mock with no linked propositions
      await page.addInitScript(() => {
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            id: "test-user-id",
            email: "test@example.com",
            roles: ["user"],
          }),
        );
        sessionStorage.setItem("petition-scan-data", "fakebase64data");
      });

      await page.route("**/api", async (route) => {
        const postData = route.request().postDataJSON();

        if (postData?.query?.includes("ProcessScan")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                processScan: {
                  documentId: "doc-1",
                  text: "Sample petition text",
                  confidence: 95,
                  provider: "tesseract",
                  processingTimeMs: 200,
                },
              },
            }),
          });
        } else if (postData?.query?.includes("AnalyzeDocument")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                analyzeDocument: {
                  analysis: mockAnalysis,
                  fromCache: false,
                },
              },
            }),
          });
        } else if (postData?.query?.includes("linkedPropositions")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: { linkedPropositions: [] },
            }),
          });
        } else {
          await route.continue();
        }
      });

      await page.goto("/petition/results");

      // Should show "Track on Ballot" button (no linked propositions)
      await expect(page.getByText("Track on Ballot")).toBeVisible({
        timeout: 15000,
      });

      // Should show the unmatched "Proposition 47" as plain text
      await expect(page.getByText("Proposition 47")).toBeVisible();
    });

    test("should display user-linked badge for manual links", async ({
      page,
    }) => {
      // Mock with a user_manual linked proposition
      await page.addInitScript(() => {
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            id: "test-user-id",
            email: "test@example.com",
            roles: ["user"],
          }),
        );
        sessionStorage.setItem("petition-scan-data", "fakebase64data");
      });

      await page.route("**/api", async (route) => {
        const postData = route.request().postDataJSON();

        if (postData?.query?.includes("ProcessScan")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                processScan: {
                  documentId: "doc-1",
                  text: "Sample petition text",
                  confidence: 95,
                  provider: "tesseract",
                  processingTimeMs: 200,
                },
              },
            }),
          });
        } else if (postData?.query?.includes("AnalyzeDocument")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                analyzeDocument: {
                  analysis: mockAnalysis,
                  fromCache: false,
                },
              },
            }),
          });
        } else if (postData?.query?.includes("linkedPropositions")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                linkedPropositions: [
                  {
                    id: "link-2",
                    propositionId: "prop-2",
                    title: "Proposition 36: Three Strikes Reform",
                    summary: "Reform three strikes law",
                    status: "PENDING",
                    electionDate: null,
                    linkSource: "user_manual",
                    confidence: null,
                    matchedText: null,
                    linkedAt: new Date().toISOString(),
                  },
                ],
              },
            }),
          });
        } else {
          await route.continue();
        }
      });

      await page.goto("/petition/results");

      // Should show the user-linked badge once linked propositions load
      await expect(page.getByText("User-linked")).toBeVisible({
        timeout: 15000,
      });
    });

    test("should show multiple linked propositions on proposition detail page", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            id: "test-user-id",
            email: "test@example.com",
            roles: ["user"],
          }),
        );
      });

      await page.route("**/api", async (route) => {
        const postData = route.request().postDataJSON();

        if (
          postData?.query?.includes("proposition(") ||
          postData?.query?.includes("proposition (")
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                proposition: {
                  id: "prop-1",
                  externalId: "Prop 47",
                  title: "Proposition 47: Criminal Sentencing",
                  summary: "Reform criminal sentencing guidelines",
                  status: "PENDING",
                  electionDate: "2024-11-05T00:00:00Z",
                  sourceUrl: null,
                  fullText: null,
                  createdAt: "2024-01-01T00:00:00Z",
                  updatedAt: "2024-01-01T00:00:00Z",
                },
              },
            }),
          });
        } else if (
          postData?.query?.includes("petitionDocumentsForProposition")
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                petitionDocumentsForProposition: [
                  {
                    id: "link-1",
                    documentId: "doc-1",
                    summary: "Petition about sentencing reform",
                    linkSource: "auto_analysis",
                    confidence: 0.9,
                    linkedAt: new Date().toISOString(),
                  },
                  {
                    id: "link-2",
                    documentId: "doc-2",
                    summary: "Community petition for criminal justice",
                    linkSource: "user_manual",
                    confidence: null,
                    linkedAt: new Date().toISOString(),
                  },
                ],
              },
            }),
          });
        } else {
          await route.continue();
        }
      });

      await page.goto("/region/propositions/prop-1");
      await page.getByRole("button", { name: "Details" }).click();

      // Both petition summaries should be visible
      await expect(
        page.getByText("Petition about sentencing reform"),
      ).toBeVisible();
      await expect(
        page.getByText("Community petition for criminal justice"),
      ).toBeVisible();

      // Both badge types should be visible
      await expect(page.getByText("AI-matched")).toBeVisible();
      await expect(page.getByText("User-linked")).toBeVisible();
    });
  });

  test.describe("Accessibility", () => {
    test("linked propositions on results page should be accessible", async ({
      page,
    }) => {
      await mockPetitionResultsGraphQL(page);
      await page.goto("/petition/results");

      // Wait for linked propositions to fully render before checking a11y
      await expect(page.getByText("AI-matched")).toBeVisible({
        timeout: 15000,
      });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      expect(results.violations).toEqual([]);
    });

    test("petition scans on proposition page should be accessible", async ({
      page,
    }) => {
      await mockPropositionDetailGraphQL(page);
      await page.goto("/region/propositions/prop-1");
      await page.getByRole("button", { name: "Details" }).click();
      await expect(page.getByText("Community Petition Scans")).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  });
});
