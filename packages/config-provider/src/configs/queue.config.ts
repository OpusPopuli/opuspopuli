import { registerAs } from "@nestjs/config";

export const queueConfig = registerAs("queue", () => ({
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  prefix: process.env.BULLMQ_PREFIX || "bullmq",
}));
