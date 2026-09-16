import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  assertAttribution,
  readPromptServiceConfig,
} from "./prompt-attribution.js";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("assertAttribution", () => {
  test("accepts a client hash that matches prompt-service", () => {
    assert.doesNotThrow(() =>
      assertAttribution("document-analysis-proposition-analysis", HASH, HASH),
    );
  });

  test("refuses a mismatch — a silent fallback is the failure it exists for", () => {
    // getTemplateFromDb substitutes document-analysis-generic without warning.
    // The run must stop rather than produce scores that name the wrong prompt.
    assert.throws(
      () =>
        assertAttribution(
          "document-analysis-proposition-analysis",
          HASH,
          OTHER,
        ),
      (e: Error) => {
        assert.match(e.message, /Prompt attribution failed/);
        assert.match(e.message, /document-analysis-proposition-analysis/);
        // Both hashes, so the reader can tell which side moved.
        assert.ok(e.message.includes(HASH) && e.message.includes(OTHER));
        return true;
      },
    );
  });
});

describe("readPromptServiceConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.PROMPT_SERVICE_URL;
    delete process.env.PROMPT_SERVICE_API_KEY;
    delete process.env.PROMPT_SERVICE_NODE_ID;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  test("refuses to fall back to the local prompt_templates table", () => {
    assert.throws(() => readPromptServiceConfig(), /PROMPT_SERVICE_URL/);
  });

  test("strips a trailing slash so paths are not doubled", () => {
    process.env.PROMPT_SERVICE_URL = "http://localhost:3210/";
    assert.equal(readPromptServiceConfig().url, "http://localhost:3210");
  });

  test("carries the api key and node id through", () => {
    process.env.PROMPT_SERVICE_URL = "http://localhost:3210";
    process.env.PROMPT_SERVICE_API_KEY = "key-123";
    process.env.PROMPT_SERVICE_NODE_ID = "node-a";
    const cfg = readPromptServiceConfig();
    assert.equal(cfg.apiKey, "key-123");
    assert.equal(cfg.nodeId, "node-a");
  });
});
