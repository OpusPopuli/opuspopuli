import { registerAs } from "@nestjs/config";

/**
 * Region Configuration
 *
 * Controls which region provider is used and sync settings.
 */
export const regionConfig = registerAs("region", () => ({
  provider: process.env.REGION_PROVIDER || "example",
  syncSchedule: process.env.REGION_SYNC_SCHEDULE || "0 2 * * *",
  syncEnabled: process.env.REGION_SYNC_ENABLED !== "false",
  port: Number.parseInt(process.env.REGION_PORT || "3004", 10),
}));
