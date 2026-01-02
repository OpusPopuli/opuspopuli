import { Module } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ExtractionModule,
  ExtractionModuleOptions,
} from "../src/extraction.module";
import { ExtractionProvider } from "../src/extraction.provider";
import { TextExtractionService } from "../src/extraction.service";
import {
  EXTRACTION_CONFIG,
  DEFAULT_EXTRACTION_CONFIG,
  ExtractionConfig,
} from "../src/types";

// Mock pdf-parse
jest.mock("pdf-parse", () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ text: "test" }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("ExtractionModule", () => {
  describe("default module", () => {
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [ExtractionModule],
      }).compile();
    });

    afterAll(async () => {
      await module.close();
    });

    it("should provide TextExtractionService", () => {
      const service = module.get<TextExtractionService>(TextExtractionService);
      expect(service).toBeDefined();
    });

    it("should provide ExtractionProvider", () => {
      const provider = module.get<ExtractionProvider>(ExtractionProvider);
      expect(provider).toBeDefined();
    });

    it("should use default config", () => {
      const config = module.get<ExtractionConfig>(EXTRACTION_CONFIG);
      expect(config).toEqual(DEFAULT_EXTRACTION_CONFIG);
    });
  });

  describe("forRoot", () => {
    let module: TestingModule;
    const customConfig: Partial<ExtractionConfig> = {
      rateLimit: { requestsPerSecond: 10, burstSize: 20 },
      cache: { ttlMs: 60000, maxSize: 50 },
    };

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [ExtractionModule.forRoot({ config: customConfig })],
      }).compile();
    });

    afterAll(async () => {
      await module.close();
    });

    it("should provide TextExtractionService", () => {
      const service = module.get<TextExtractionService>(TextExtractionService);
      expect(service).toBeDefined();
    });

    it("should provide ExtractionProvider", () => {
      const provider = module.get<ExtractionProvider>(ExtractionProvider);
      expect(provider).toBeDefined();
    });

    it("should merge custom config with defaults", () => {
      const config = module.get<ExtractionConfig>(EXTRACTION_CONFIG);

      expect(config.rateLimit.requestsPerSecond).toBe(10);
      expect(config.rateLimit.burstSize).toBe(20);
      expect(config.cache.ttlMs).toBe(60000);
      expect(config.cache.maxSize).toBe(50);
      // Should keep default retry config
      expect(config.retry).toEqual(DEFAULT_EXTRACTION_CONFIG.retry);
    });

    it("should allow partial nested config", async () => {
      const partialModule = await Test.createTestingModule({
        imports: [
          ExtractionModule.forRoot({
            config: {
              rateLimit: { requestsPerSecond: 5 }, // Only override one property
            },
          }),
        ],
      }).compile();

      const config = partialModule.get<ExtractionConfig>(EXTRACTION_CONFIG);

      expect(config.rateLimit.requestsPerSecond).toBe(5);
      expect(config.rateLimit.burstSize).toBe(
        DEFAULT_EXTRACTION_CONFIG.rateLimit.burstSize,
      );

      await partialModule.close();
    });
  });

  describe("forRootAsync", () => {
    it("should support async configuration", async () => {
      const asyncConfig: Partial<ExtractionConfig> = {
        rateLimit: { requestsPerSecond: 15 },
        cache: { ttlMs: 120000 },
      };

      const module = await Test.createTestingModule({
        imports: [
          ExtractionModule.forRootAsync({
            useFactory: async (): Promise<ExtractionModuleOptions> => ({
              config: asyncConfig,
            }),
          }),
        ],
      }).compile();

      const config = module.get<ExtractionConfig>(EXTRACTION_CONFIG);

      expect(config.rateLimit.requestsPerSecond).toBe(15);
      expect(config.cache.ttlMs).toBe(120000);
      expect(config.retry).toEqual(DEFAULT_EXTRACTION_CONFIG.retry);

      await module.close();
    });

    it("should support injected dependencies via imports", async () => {
      const CONFIG_TOKEN = "TEST_CONFIG";
      const testConfig = { rps: 25 };

      // Create a simple config module to provide the token
      @Module({
        providers: [
          {
            provide: CONFIG_TOKEN,
            useValue: testConfig,
          },
        ],
        exports: [CONFIG_TOKEN],
      })
      class TestConfigModule {}

      const module = await Test.createTestingModule({
        imports: [
          ExtractionModule.forRootAsync({
            imports: [TestConfigModule],
            inject: [CONFIG_TOKEN],
            useFactory: (
              injectedConfig: typeof testConfig,
            ): ExtractionModuleOptions => ({
              config: {
                rateLimit: { requestsPerSecond: injectedConfig.rps },
              },
            }),
          }),
        ],
      }).compile();

      const config = module.get<ExtractionConfig>(EXTRACTION_CONFIG);

      expect(config.rateLimit.requestsPerSecond).toBe(25);

      await module.close();
    });
  });
});
