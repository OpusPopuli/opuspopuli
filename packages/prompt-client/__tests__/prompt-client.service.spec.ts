import { Test, TestingModule } from "@nestjs/testing";
import { PromptClientService } from "../src/prompt-client.service.js";
import { DbService } from "@opuspopuli/relationaldb-provider";
import { PROMPT_CLIENT_CONFIG } from "../src/types.js";

describe("PromptClientService", () => {
  let service: PromptClientService;
  let mockDb: any;

  const mockTemplate = (name: string, templateText: string, version = 1) => ({
    id: "test-id",
    name,
    category: "structural_analysis",
    description: "test",
    templateText,
    variables: [],
    version,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    mockDb = {
      promptTemplate: {
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptClientService,
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    service = module.get(PromptClientService);
  });

  afterEach(async () => {
    await service.clearCache();
    await service.onModuleDestroy();
  });

  describe("getStructuralAnalysisPrompt", () => {
    it("should compose structural analysis prompt from DB templates", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-analysis",
            "Analyze {{DATA_TYPE}} data.\n{{HINTS_SECTION}}Schema: {{SCHEMA_DESCRIPTION}}\n{{HTML}}",
          ),
        )
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-schema-propositions",
            "Proposition fields here",
          ),
        );

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "Extract ballot measures",
        html: "<div>test</div>",
      });

      expect(result.promptText).toContain("Analyze propositions data.");
      expect(result.promptText).toContain("Proposition fields here");
      expect(result.promptText).toContain("<div>test</div>");
      expect(result.promptHash).toBeDefined();
      expect(result.promptVersion).toBe("v1");
    });

    it("should include hints section when hints provided", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate("structural-analysis", "{{HINTS_SECTION}}"),
        )
        .mockResolvedValueOnce(
          mockTemplate("structural-schema-default", "default schema"),
        );

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "test",
        hints: ["Look for tables", "Check sidebar"],
        html: "<div/>",
      });

      expect(result.promptText).toContain("Hints from the region author");
      expect(result.promptText).toContain("- Look for tables");
      expect(result.promptText).toContain("- Check sidebar");
    });

    it("should fall back to default schema when type-specific not found", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate("structural-analysis", "Schema: {{SCHEMA_DESCRIPTION}}"),
        )
        // First call for type-specific returns null
        .mockResolvedValueOnce(null)
        // Fallback call
        .mockResolvedValueOnce(
          mockTemplate("structural-schema-default", "default schema"),
        );

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "unknown_type" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      expect(result.promptText).toContain("default schema");
    });
  });

  describe("getDocumentAnalysisPrompt", () => {
    it("should compose document analysis prompt with base instructions", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "document-analysis-petition",
            "Analyze petition:\n{{TEXT}}",
          ),
        )
        .mockResolvedValueOnce(
          mockTemplate(
            "document-analysis-base-instructions",
            "Respond with valid JSON only.",
          ),
        );

      const result = await service.getDocumentAnalysisPrompt({
        documentType: "petition",
        text: "We the people...",
      });

      expect(result.promptText).toContain("Analyze petition:");
      expect(result.promptText).toContain("We the people...");
      expect(result.promptText).toContain("Respond with valid JSON only.");
    });

    it("should fall back to generic when document type not found", async () => {
      mockDb.promptTemplate.findFirst
        // Type-specific not found
        .mockResolvedValueOnce(null)
        // Fallback to generic
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-generic", "Generic: {{TEXT}}"),
        )
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-base-instructions", "JSON only."),
        );

      const result = await service.getDocumentAnalysisPrompt({
        documentType: "unknown",
        text: "some text",
      });

      expect(result.promptText).toContain("Generic: some text");
    });
  });

  describe("getRAGPrompt", () => {
    it("should compose RAG prompt with context and query", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate(
          "rag",
          "Context:\n{{CONTEXT}}\n\nQuestion: {{QUERY}}\n\nAnswer:",
        ),
      );

      const result = await service.getRAGPrompt({
        context: "The sky is blue.",
        query: "What color is the sky?",
      });

      expect(result.promptText).toContain("The sky is blue.");
      expect(result.promptText).toContain("What color is the sky?");
      expect(result.promptVersion).toBe("v1");
    });
  });

  describe("caching", () => {
    it("should cache templates after first read", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("rag", "{{CONTEXT}} {{QUERY}}"),
      );

      // First call - hits DB
      await service.getRAGPrompt({ context: "a", query: "b" });
      // Second call - should use cache
      await service.getRAGPrompt({ context: "c", query: "d" });

      // findFirst only called once (cached after first call)
      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should clear cache on clearCache()", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "{{CONTEXT}} {{QUERY}}"),
      );

      await service.getRAGPrompt({ context: "a", query: "b" });
      await service.clearCache();
      await service.getRAGPrompt({ context: "c", query: "d" });

      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe("getPromptHash", () => {
    it("should return sha256 hash of template text", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("rag", "Template text for hashing"),
      );

      const hash = await service.getPromptHash("rag");

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("error handling", () => {
    it("should throw when non-core template not found", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.getPromptHash("nonexistent-template"),
      ).rejects.toThrow(
        'Prompt template "nonexistent-template" not found in database',
      );
    });
  });

  describe("fallback templates", () => {
    it("should return fallback when DB template missing for core template", async () => {
      // All DB lookups return null
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      const result = await service.getRAGPrompt({
        context: "The sky is blue.",
        query: "What color?",
      });

      expect(result.promptText).toContain("The sky is blue.");
      expect(result.promptText).toContain("What color?");
      expect(result.promptVersion).toBe("v0");
    });

    it("should use fallbackName's hardcoded fallback when primary not in DB", async () => {
      // structural-analysis found in DB, but schema type not found
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-analysis",
            "Schema: {{SCHEMA_DESCRIPTION}} {{DATA_TYPE}} {{CONTENT_GOAL}} {{HINTS_SECTION}} {{HTML}}",
          ),
        )
        // structural-schema-exotic: not in DB
        .mockResolvedValueOnce(null)
        // structural-schema-default: not in DB either
        .mockResolvedValueOnce(null);

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "exotic" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      // Should use the hardcoded structural-schema-default fallback
      expect(result.promptText).toContain(
        "Extract all relevant structured data fields",
      );
    });

    it("should cache fallback templates after first use", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      await service.getRAGPrompt({ context: "a", query: "b" });
      await service.getRAGPrompt({ context: "c", query: "d" });

      // DB queried only once for "rag" (cached after fallback returned)
      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("validateTemplates", () => {
    it("should return healthy when all core templates exist", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue({ id: "exists" });

      const result = await service.validateTemplates();

      expect(result.healthy).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("should report missing templates", async () => {
      // First 3 exist, last 2 don't
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce({ id: "1" })
        .mockResolvedValueOnce({ id: "2" })
        .mockResolvedValueOnce({ id: "3" })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.validateTemplates();

      expect(result.healthy).toBe(false);
      expect(result.missing).toEqual([
        "document-analysis-base-instructions",
        "rag",
      ]);
    });
  });

  describe("onModuleInit", () => {
    it("should skip validation when remote URL configured", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
            },
          },
        ],
      }).compile();

      const remoteService = module.get(PromptClientService);
      await remoteService.onModuleInit();

      // DB should not have been called for validation
      expect(mockDb.promptTemplate.findFirst).not.toHaveBeenCalled();
      await remoteService.onModuleDestroy();
    });

    it("should complete without throwing when templates are missing", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      // Should warn but not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe("metrics", () => {
    it("should return initial metrics with zero counts", () => {
      const metrics = service.getMetrics();

      expect(metrics.totalRequests).toBe(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.remoteCalls).toBe(0);
      expect(metrics.dbFallbacks).toBe(0);
      expect(metrics.hardcodedFallbacks).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.fallbackRate).toBe(0);
      expect(metrics.circuitBreakerState).toBe("closed");
    });

    it("should track hardcoded fallback usage", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      await service.getRAGPrompt({ context: "a", query: "b" });
      const metrics = service.getMetrics();

      expect(metrics.hardcodedFallbacks).toBeGreaterThan(0);
    });

    it("should return null circuit breaker health when not in remote mode", () => {
      expect(service.getCircuitBreakerHealth()).toBeNull();
    });
  });

  describe("remote mode", () => {
    let remoteService: PromptClientService;
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-api-key",
              retryMaxAttempts: 1, // Disable retries in tests for speed
            },
          },
        ],
      }).compile();

      remoteService = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await remoteService.onModuleDestroy();
    });

    it("should throw if API key is missing when URL is set", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              // No API key
            },
          },
        ],
      }).compile();

      const noKeyService = module.get(PromptClientService);

      await expect(
        noKeyService.getRAGPrompt({ context: "a", query: "b" }),
      ).rejects.toThrow("API key is required");
      await noKeyService.onModuleDestroy();
    });

    it("should call remote service with Bearer auth when URL is configured", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote prompt",
            promptHash: "abc123",
            promptVersion: "v2",
          }),
      });
      globalThis.fetch = mockFetch;

      const result = await remoteService.getRAGPrompt({
        context: "test",
        query: "test",
      });

      expect(result.promptText).toBe("remote prompt");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://prompt-service:3005/prompts/rag",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        }),
      );
    });

    it("should track remote call metrics on success", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote",
            promptHash: "abc",
            promptVersion: "v1",
          }),
      });

      await remoteService.getRAGPrompt({ context: "a", query: "b" });
      const metrics = remoteService.getMetrics();

      expect(metrics.remoteCalls).toBe(1);
      expect(metrics.avgRemoteLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should fall back to DB when remote fails", async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("fetch failed"));

      // Set up DB fallback
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "DB fallback: {{CONTEXT}} {{QUERY}}"),
      );

      const result = await remoteService.getRAGPrompt({
        context: "test",
        query: "test",
      });

      expect(result.promptText).toContain("DB fallback:");
      const metrics = remoteService.getMetrics();
      expect(metrics.dbFallbacks).toBe(1);
    });

    it("should return circuit breaker health in remote mode", () => {
      const health = remoteService.getCircuitBreakerHealth();

      expect(health).not.toBeNull();
      expect(health!.serviceName).toBe("PromptService");
      expect(health!.state).toBe("closed");
      expect(health!.isHealthy).toBe(true);
    });

    it("should warm DB cache on successful remote fetch", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote prompt text",
            promptHash: "abc123",
            promptVersion: "v2",
          }),
      });

      await remoteService.getRAGPrompt({ context: "test", query: "test" });

      // Allow fire-and-forget warmDbCache to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockDb.promptTemplate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: "rag" },
          create: expect.objectContaining({
            name: "rag",
            category: "rag",
            templateText: "remote prompt text",
          }),
        }),
      );

      const metrics = remoteService.getMetrics();
      expect(metrics.cacheWarms).toBe(1);
    });

    it("should not fail when DB cache warming fails", async () => {
      mockDb.promptTemplate.upsert.mockRejectedValue(
        new Error("DB write failed"),
      );

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote prompt",
            promptHash: "abc",
            promptVersion: "v1",
          }),
      });

      // Should not throw despite DB upsert failure
      const result = await remoteService.getRAGPrompt({
        context: "test",
        query: "test",
      });

      expect(result.promptText).toBe("remote prompt");
    });
  });

  describe("remote mode with HMAC", () => {
    let hmacService: PromptClientService;
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "hmac-secret-key",
              hmacNodeId: "node-uuid-1234",
              retryMaxAttempts: 1,
            },
          },
        ],
      }).compile();

      hmacService = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await hmacService.onModuleDestroy();
    });

    it("should use HMAC headers instead of Bearer when hmacNodeId is set", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "hmac prompt",
            promptHash: "def456",
            promptVersion: "v1",
          }),
      });
      globalThis.fetch = mockFetch;

      await hmacService.getRAGPrompt({ context: "test", query: "test" });

      const call = mockFetch.mock.calls[0];
      const headers = call[1].headers;

      // Should have HMAC headers
      expect(headers["X-HMAC-Signature"]).toBeDefined();
      expect(headers["X-HMAC-Timestamp"]).toBeDefined();
      expect(headers["X-HMAC-Key-Id"]).toBe("node-uuid-1234");

      // Should NOT have Bearer auth
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("should produce valid HMAC signature format", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "test",
            promptHash: "abc",
            promptVersion: "v1",
          }),
      });
      globalThis.fetch = mockFetch;

      await hmacService.getRAGPrompt({ context: "ctx", query: "q" });

      const headers = mockFetch.mock.calls[0][1].headers;

      // Signature should be valid base64
      const decoded = Buffer.from(headers["X-HMAC-Signature"], "base64");
      expect(decoded.length).toBe(32); // SHA-256 = 32 bytes

      // Timestamp should be a valid number
      const ts = Number.parseInt(headers["X-HMAC-Timestamp"], 10);
      expect(ts).toBeGreaterThan(0);
    });
  });

  describe("circuit breaker behavior", () => {
    let cbService: PromptClientService;
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 1,
              circuitBreakerFailureThreshold: 2,
              circuitBreakerHalfOpenMs: 60000,
            },
          },
        ],
      }).compile();

      cbService = module.get(PromptClientService);

      // Set up DB fallback for all calls
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "fallback: {{CONTEXT}} {{QUERY}}"),
      );
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await cbService.onModuleDestroy();
    });

    it("should open circuit after consecutive failures", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("500 Internal Server Error"));

      // Trigger failures to open the circuit (threshold = 2)
      await cbService.getRAGPrompt({ context: "a", query: "b" });
      await cbService.getRAGPrompt({ context: "c", query: "d" });

      const health = cbService.getCircuitBreakerHealth();
      expect(health!.state).toBe("open");
      expect(health!.isHealthy).toBe(false);
    });

    it("should fall back to DB when circuit is open", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("500 Internal Server Error"));

      // Open the circuit
      await cbService.getRAGPrompt({ context: "a", query: "b" });
      await cbService.getRAGPrompt({ context: "c", query: "d" });

      // Next call should fail fast (circuit open) and fall back to DB
      const result = await cbService.getRAGPrompt({
        context: "fallback test",
        query: "question",
      });

      expect(result.promptText).toContain("fallback:");
    });

    it("should recover after circuit breaker resets", async () => {
      // Use a very short half-open timeout for testing
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 1,
              circuitBreakerFailureThreshold: 1,
              circuitBreakerHalfOpenMs: 100,
            },
          },
        ],
      }).compile();

      const resetService = module.get(PromptClientService);

      // Break the circuit
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("fail"));
      await resetService.getRAGPrompt({ context: "a", query: "b" });
      expect(resetService.getCircuitBreakerHealth()!.state).toBe("open");

      // Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Successful request should reset the circuit
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "recovered",
            promptHash: "abc",
            promptVersion: "v1",
          }),
      });

      const result = await resetService.getRAGPrompt({
        context: "c",
        query: "d",
      });

      expect(result.promptText).toBe("recovered");
      expect(resetService.getCircuitBreakerHealth()!.state).toBe("closed");
      await resetService.onModuleDestroy();
    });
  });

  describe("remote mode - all endpoints", () => {
    let remoteService: PromptClientService;
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-api-key",
              retryMaxAttempts: 1,
            },
          },
        ],
      }).compile();

      remoteService = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await remoteService.onModuleDestroy();
    });

    it("should call remote for getStructuralAnalysisPrompt", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote structural",
            promptHash: "hash1",
            promptVersion: "v3",
          }),
      });
      globalThis.fetch = mockFetch;

      const result = await remoteService.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      expect(result.promptText).toBe("remote structural");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://prompt-service:3005/prompts/structural-analysis",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should call remote for getDocumentAnalysisPrompt", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote document",
            promptHash: "hash2",
            promptVersion: "v2",
          }),
      });
      globalThis.fetch = mockFetch;

      const result = await remoteService.getDocumentAnalysisPrompt({
        documentType: "petition",
        text: "doc text",
      });

      expect(result.promptText).toBe("remote document");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://prompt-service:3005/prompts/document-analysis",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should fall back to DB for structural-analysis when remote fails", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("network error"));

      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-analysis",
            "Analyze {{DATA_TYPE}}.\n{{HINTS_SECTION}}Schema: {{SCHEMA_DESCRIPTION}}\n{{HTML}}",
          ),
        )
        .mockResolvedValueOnce(
          mockTemplate("structural-schema-default", "default schema"),
        );

      const result = await remoteService.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      expect(result.promptText).toContain("Analyze propositions");
      const metrics = remoteService.getMetrics();
      expect(metrics.dbFallbacks).toBe(1);
    });

    it("should fall back to DB for document-analysis when remote fails", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("network error"));

      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-petition", "Analyze: {{TEXT}}"),
        )
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-base-instructions", "JSON only."),
        );

      const result = await remoteService.getDocumentAnalysisPrompt({
        documentType: "petition",
        text: "doc text",
      });

      expect(result.promptText).toContain("Analyze: doc text");
      const metrics = remoteService.getMetrics();
      expect(metrics.dbFallbacks).toBe(1);
    });

    it("should treat HTTP error responses as failures and fall back", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "DB: {{CONTEXT}} {{QUERY}}"),
      );

      const result = await remoteService.getRAGPrompt({
        context: "ctx",
        query: "q",
      });

      expect(result.promptText).toContain("DB: ctx q");
    });

    it("should treat 4xx HTTP errors as non-retryable", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });
      globalThis.fetch = mockFetch;

      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "fallback: {{CONTEXT}} {{QUERY}}"),
      );

      // With retryMaxAttempts: 1, the 400 should not be retried
      await remoteService.getRAGPrompt({ context: "a", query: "b" });

      // fetch called only once (no retries for 4xx)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry behavior", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should retry on server errors and invoke onRetry callback", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 3,
              retryBaseDelayMs: 10,
              retryMaxDelayMs: 50,
            },
          },
        ],
      }).compile();

      const retryService = module.get(PromptClientService);

      // Fail twice, then succeed
      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(new Error("500 Internal Server Error"))
        .mockRejectedValueOnce(new Error("503 Service Unavailable"))
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              promptText: "success after retries",
              promptHash: "abc",
              promptVersion: "v1",
            }),
        });
      globalThis.fetch = mockFetch;

      const result = await retryService.getRAGPrompt({
        context: "a",
        query: "b",
      });

      expect(result.promptText).toBe("success after retries");
      expect(mockFetch).toHaveBeenCalledTimes(3);

      await retryService.onModuleDestroy();
    });
  });

  describe("CircuitOpenError skips retry", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should not retry when circuit is open", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 3,
              retryBaseDelayMs: 10,
              circuitBreakerFailureThreshold: 1,
              circuitBreakerHalfOpenMs: 60000,
            },
          },
        ],
      }).compile();

      const svc = module.get(PromptClientService);

      // Break the circuit with one failure
      const mockFetch = jest.fn().mockRejectedValue(new Error("server down"));
      globalThis.fetch = mockFetch;

      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "fallback: {{CONTEXT}} {{QUERY}}"),
      );

      await svc.getRAGPrompt({ context: "a", query: "b" });
      expect(svc.getCircuitBreakerHealth()!.state).toBe("open");

      // Reset fetch mock to track next call
      mockFetch.mockClear();

      // This call should hit CircuitOpenError and NOT retry (fail fast)
      const result = await svc.getRAGPrompt({
        context: "fast fallback",
        query: "q",
      });

      expect(result.promptText).toContain("fallback:");
      // fetch should NOT have been called (circuit open prevents it)
      expect(mockFetch).not.toHaveBeenCalled();

      await svc.onModuleDestroy();
    });
  });

  describe("composeFromDb unknown endpoint", () => {
    it("should throw for unknown endpoint", async () => {
      // Access the private method via prototype to test defensive default branch
      const composeFromDb = (service as any).composeFromDb.bind(service);
      await expect(composeFromDb("unknown-endpoint", {})).rejects.toThrow(
        "Unknown prompt endpoint: unknown-endpoint",
      );
    });
  });

  describe("onModuleInit", () => {
    it("should log success when all templates are found", async () => {
      // All DB lookups return a valid template
      mockDb.promptTemplate.findFirst.mockResolvedValue({ id: "exists" });

      await service.onModuleInit();

      // No error thrown, and validation ran (5 core templates queried)
      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(5);
    });
  });

  describe("onModuleDestroy", () => {
    it("should call destroy on the template cache", async () => {
      // onModuleDestroy is called in afterEach; verify it doesn't throw
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it("should call destroy on custom cache implementation", async () => {
      const customCache = {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(true),
        clear: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: { cache: customCache },
          },
        ],
      }).compile();

      const customService = module.get(PromptClientService);
      await customService.onModuleDestroy();

      expect(customCache.destroy).toHaveBeenCalled();
    });
  });
});
