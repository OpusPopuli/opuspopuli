/**
 * Seed script for region plugins.
 *
 * Creates the default example plugin entry so the platform
 * can load it from DB config on startup.
 *
 * Usage: npx ts-node prisma/seeds/region-plugins.seed.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedRegionPlugins() {
  const result = await prisma.regionPlugin.upsert({
    where: { name: "example" },
    update: {},
    create: {
      name: "example",
      displayName: "Example Region",
      description:
        "Sample region with mock civic data for development and testing",
      packageName: "@opuspopuli/region-template",
      version: "0.1.0",
      enabled: true,
    },
  });

  console.log(`Seeded region plugin: ${result.name} (${result.id})`);
}

seedRegionPlugins()
  .catch((error) => {
    console.error("Failed to seed region plugins:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
