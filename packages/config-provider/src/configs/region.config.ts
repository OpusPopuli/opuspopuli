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
  // Feature flag: replace @Cron scheduler with BullMQ repeatable job
  syncCronViaQueue: process.env.REGION_SYNC_CRON_VIA_QUEUE === "true",
  // Worker: enable the BullMQ daily repeatable job (default false in dev)
  syncCronEnabled: process.env.REGION_SYNC_CRON_ENABLED !== "false",
  // Worker: enqueue a one-shot startup job (default false)
  syncRunOnStartup: process.env.REGION_SYNC_RUN_ON_STARTUP === "true",
  port: Number.parseInt(process.env.REGION_PORT || "3004", 10),
  workerPort: Number.parseInt(process.env.REGION_WORKER_PORT || "3005", 10),
}));
