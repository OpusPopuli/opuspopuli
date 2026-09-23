import { registerAs } from "@nestjs/config";

export const queueConfig = registerAs("queue", () => ({
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  /**
   * Redis key namespace. Left UNRESOLVED on purpose — the fallback lives in
   * `@opuspopuli/queue-provider` as `DEFAULT_QUEUE_PREFIX`, and config-provider
   * is deliberately dependency-free so it cannot import it.
   *
   * Repeating the default here would recreate exactly the problem #1319 is
   * about: one namespace with several definitions that can silently disagree.
   * A consumer passes this straight to `resolveQueuePrefix`, which applies the
   * single shared default when it is undefined.
   */
  prefix: process.env.BULLMQ_PREFIX?.trim() || undefined,
}));
