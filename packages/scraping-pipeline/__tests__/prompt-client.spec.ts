import { PromptClientService } from "../src/analysis/prompt-client.service";
import { DataType, type DataSourceConfig } from "@opuspopuli/common";

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://www.assembly.ca.gov/members",
    dataType: DataType.REPRESENTATIVES,
    contentGoal: "Extract all assembly members with name, district, and party",
    ...overrides,
  };
}

describe("PromptClientService", () => {
  describe("local fallback mode", () => {
    let client: PromptClientService;

    beforeEach(() => {
      client = new PromptClientService();
    });

    it("should build local prompt with data type and content goal", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource(),
        "<div>HTML</div>",
      );

      expect(response.promptText).toContain("representatives");
      expect(response.promptText).toContain(
        "Extract all assembly members with name, district, and party",
      );
      expect(response.promptText).toContain("<div>HTML</div>");
    });

    it("should include hints section when hints provided", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource({ hints: ["Table layout", "5 columns"] }),
        "<div>HTML</div>",
      );

      expect(response.promptText).toContain("Table layout");
      expect(response.promptText).toContain("5 columns");
      expect(response.promptText).toContain("Hints from the region author");
    });

    it("should omit hints section when no hints", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource(),
        "<div>HTML</div>",
      );

      expect(response.promptText).not.toContain("Hints from the region author");
    });

    it("should include schema description for propositions", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource({ dataType: DataType.PROPOSITIONS }),
        "<div>HTML</div>",
      );

      expect(response.promptText).toContain("externalId");
      expect(response.promptText).toContain("ballot measure");
    });

    it("should include schema description for meetings", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource({ dataType: DataType.MEETINGS }),
        "<div>HTML</div>",
      );

      expect(response.promptText).toContain("scheduledAt");
    });

    it("should include schema description for representatives", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource({ dataType: DataType.REPRESENTATIVES }),
        "<div>HTML</div>",
      );

      expect(response.promptText).toContain("district");
      expect(response.promptText).toContain("party");
    });

    it("should return a prompt hash", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource(),
        "<div>HTML</div>",
      );

      expect(response.promptHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should return consistent prompt hash for same data type", async () => {
      const r1 = await client.getStructuralAnalysisPrompt(
        createSource(),
        "<div>HTML1</div>",
      );
      const r2 = await client.getStructuralAnalysisPrompt(
        createSource(),
        "<div>HTML2</div>",
      );

      // Hash is based on the template, not the content
      expect(r1.promptHash).toBe(r2.promptHash);
    });

    it("should return prompt version as local-dev-v1", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource(),
        "<div>HTML</div>",
      );

      expect(response.promptVersion).toBe("local-dev-v1");
    });

    it("should include category when provided", async () => {
      const response = await client.getStructuralAnalysisPrompt(
        createSource({ category: "Assembly" }),
        "<div>HTML</div>",
      );

      expect(response.promptText).toContain("Assembly");
    });
  });

  describe("getPromptHash", () => {
    it("should return a SHA-256 hash", async () => {
      const client = new PromptClientService();
      const hash = await client.getPromptHash(DataType.PROPOSITIONS);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should return consistent hash for same data type", async () => {
      const client = new PromptClientService();
      const h1 = await client.getPromptHash(DataType.PROPOSITIONS);
      const h2 = await client.getPromptHash(DataType.PROPOSITIONS);

      expect(h1).toBe(h2);
    });
  });

  describe("remote mode", () => {
    it("should call remote service when URL configured", async () => {
      const mockResponse = {
        promptText: "Remote prompt",
        promptHash: "remote-hash",
        promptVersion: "v2.1",
      };

      const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = new PromptClientService({
        promptServiceUrl: "https://prompt-service.example.com",
        promptServiceApiKey: "test-key",
      });

      const result = await client.getStructuralAnalysisPrompt(
        createSource(),
        "<div>HTML</div>",
      );

      expect(result.promptText).toBe("Remote prompt");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://prompt-service.example.com/prompts/structural-analysis",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it("should throw on non-OK response from remote service", async () => {
      const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const client = new PromptClientService({
        promptServiceUrl: "https://prompt-service.example.com",
      });

      await expect(
        client.getStructuralAnalysisPrompt(createSource(), "<div>HTML</div>"),
      ).rejects.toThrow("Prompt service returned 500");

      fetchSpy.mockRestore();
    });
  });
});
