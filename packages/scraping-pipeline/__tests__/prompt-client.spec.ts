/**
 * Prompt Client Service Tests (scraping pipeline re-export)
 *
 * The PromptClientService is now provided by @opuspopuli/prompt-client.
 * Comprehensive tests live in packages/prompt-client/__tests__/.
 *
 * This test file verifies the re-export works correctly.
 */

import { PromptClientService } from "../src/analysis/prompt-client.service";

describe("PromptClientService re-export", () => {
  it("should re-export PromptClientService from @opuspopuli/prompt-client", () => {
    expect(PromptClientService).toBeDefined();
    expect(typeof PromptClientService).toBe("function");
  });
});
