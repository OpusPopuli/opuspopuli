/**
 * Integration test setup for extraction-provider
 * Verifies Redis is available before running tests
 */
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

async function checkRedis(): Promise<boolean> {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    await redis.ping();
    await redis.quit();
    return true;
  } catch {
    try {
      await redis.quit();
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

export default async function globalSetup() {
  console.log(`\nChecking Redis at ${REDIS_URL}...`);

  const maxWait = 30000; // 30 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const isReady = await checkRedis();

    if (isReady) {
      console.log("✓ Redis is ready");
      return;
    }

    console.log("  Waiting for Redis...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(
    `Redis not available at ${REDIS_URL}.\n\n` +
      "To start Redis:\n" +
      "  docker compose up -d redis\n\n" +
      "Or run with docker-compose-integration.yml:\n" +
      "  docker compose -f docker-compose-integration.yml up -d redis",
  );
}
