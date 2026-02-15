/**
 * Seed script for region plugins.
 *
 * Creates the default example plugin and the California declarative plugin.
 *
 * Usage: npx ts-node prisma/seeds/region-plugins.seed.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedRegionPlugins() {
  // Example plugin (code-based, for development/testing)
  const example = await prisma.regionPlugin.upsert({
    where: { name: "example" },
    update: {},
    create: {
      name: "example",
      displayName: "Example Region",
      description:
        "Sample region with mock civic data for development and testing",
      packageName: "@opuspopuli/region-template",
      pluginType: "code",
      version: "0.1.0",
      enabled: true,
    },
  });

  console.log(`Seeded region plugin: ${example.name} (${example.id})`);

  // California plugin (declarative, uses scraping pipeline)
  const california = await prisma.regionPlugin.upsert({
    where: { name: "california" },
    update: {},
    create: {
      name: "california",
      displayName: "California",
      description:
        "California civic data — propositions, legislative meetings, and elected representatives",
      pluginType: "declarative",
      version: "1.0.0",
      enabled: false,
      config: {
        regionId: "california",
        regionName: "California",
        description:
          "California civic data from official state government websites",
        timezone: "America/Los_Angeles",
        dataSources: [
          {
            url: "https://www.sos.ca.gov/elections/ballot-measures/qualified-ballot-measures",
            dataType: "propositions",
            contentGoal:
              "Extract qualified ballot measures with measure ID, title, description, and election date",
            category: "Secretary of State",
            hints: [
              "Measures are grouped under election date headings",
              "Each measure has an identifier like ACA 13 or SB 1234",
              "Link text contains the measure title",
            ],
          },
          {
            url: "https://www.assembly.ca.gov/schedules-publications/assembly-daily-file",
            dataType: "meetings",
            contentGoal:
              "Extract scheduled Assembly committee meetings with date, time, location, and committee name",
            category: "Assembly",
            hints: [
              "Daily file contains committee hearing schedules",
              "Look for tables or structured lists with date, time, and room info",
            ],
          },
          {
            url: "https://www.senate.ca.gov/publications/senate-daily-file",
            dataType: "meetings",
            contentGoal:
              "Extract scheduled Senate committee meetings with date, time, location, and committee name",
            category: "Senate",
            hints: [
              "Senate daily file format may differ from Assembly",
              "Look for committee names, dates, times, and locations",
            ],
          },
          {
            url: "https://www.assembly.ca.gov/assemblymembers",
            dataType: "representatives",
            contentGoal:
              "Extract Assembly members with name, district number, party affiliation, and photo",
            category: "Assembly",
            hints: [
              "Member cards in a grid layout",
              "Each card has a photo, name, district, and party",
              "80 Assembly members total",
            ],
          },
          {
            url: "https://www.senate.ca.gov/senators",
            dataType: "representatives",
            contentGoal:
              "Extract Senators with name, district number, party affiliation, and photo",
            category: "Senate",
            hints: [
              "Senator cards with expandable details",
              "Each has name, district, party, and photo",
              "40 Senators total",
            ],
          },
        ],
        rateLimit: {
          requestsPerSecond: 1,
          burstSize: 3,
        },
        cacheTtlMs: 900000,
        requestTimeoutMs: 30000,
      },
    },
  });

  console.log(`Seeded region plugin: ${california.name} (${california.id})`);
}

seedRegionPlugins()
  .catch((error) => {
    console.error("Failed to seed region plugins:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
