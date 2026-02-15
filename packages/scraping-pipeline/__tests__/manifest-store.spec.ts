import {
  ManifestStoreService,
  type ManifestRepository,
  type ManifestRecord,
} from "../src/manifest/manifest-store.service";
import { DataType, type StructuralManifest } from "@opuspopuli/common";

function createMockRepository(): jest.Mocked<ManifestRepository> {
  return {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
}

function createManifest(
  overrides: Partial<StructuralManifest> = {},
): StructuralManifest {
  return {
    id: "manifest-1",
    regionId: "california",
    sourceUrl: "https://example.com",
    dataType: DataType.PROPOSITIONS,
    version: 1,
    structureHash: "hash-abc",
    promptHash: "hash-def",
    extractionRules: {
      containerSelector: ".container",
      itemSelector: ".item",
      fieldMappings: [],
    },
    confidence: 0.8,
    successCount: 5,
    failureCount: 1,
    isActive: true,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function createRecord(overrides: Partial<ManifestRecord> = {}): ManifestRecord {
  return {
    id: "manifest-1",
    regionId: "california",
    sourceUrl: "https://example.com",
    dataType: "propositions",
    version: 1,
    structureHash: "hash-abc",
    promptHash: "hash-def",
    extractionRules: {
      containerSelector: ".container",
      itemSelector: ".item",
      fieldMappings: [],
    },
    confidence: 0.8,
    successCount: 5,
    failureCount: 1,
    isActive: true,
    llmProvider: "ollama",
    llmModel: "llama3",
    llmTokensUsed: 1500,
    analysisTimeMs: 3000,
    lastUsedAt: new Date("2026-01-15"),
    lastCheckedAt: new Date("2026-01-15"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-15"),
    ...overrides,
  };
}

describe("ManifestStoreService", () => {
  let store: ManifestStoreService;
  let repo: jest.Mocked<ManifestRepository>;

  beforeEach(() => {
    repo = createMockRepository();
    store = new ManifestStoreService(repo);
  });

  describe("findLatest", () => {
    it("should return manifest when found", async () => {
      repo.findFirst.mockResolvedValue(createRecord());

      const result = await store.findLatest(
        "california",
        "https://example.com",
        DataType.PROPOSITIONS,
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("manifest-1");
      expect(result!.regionId).toBe("california");
      expect(result!.dataType).toBe(DataType.PROPOSITIONS);
      expect(repo.findFirst).toHaveBeenCalledWith({
        where: {
          regionId: "california",
          sourceUrl: "https://example.com",
          dataType: "propositions",
          isActive: true,
        },
        orderBy: { version: "desc" },
      });
    });

    it("should return undefined when no manifest found", async () => {
      repo.findFirst.mockResolvedValue(null);

      const result = await store.findLatest(
        "california",
        "https://example.com",
        DataType.PROPOSITIONS,
      );

      expect(result).toBeUndefined();
    });

    it("should map null optional fields to undefined", async () => {
      repo.findFirst.mockResolvedValue(
        createRecord({
          llmProvider: null,
          llmModel: null,
          llmTokensUsed: null,
          analysisTimeMs: null,
          lastUsedAt: null,
          lastCheckedAt: null,
        }),
      );

      const result = await store.findLatest(
        "california",
        "https://example.com",
        DataType.PROPOSITIONS,
      );

      expect(result!.llmProvider).toBeUndefined();
      expect(result!.llmModel).toBeUndefined();
      expect(result!.llmTokensUsed).toBeUndefined();
      expect(result!.analysisTimeMs).toBeUndefined();
      expect(result!.lastUsedAt).toBeUndefined();
      expect(result!.lastCheckedAt).toBeUndefined();
    });
  });

  describe("save", () => {
    it("should deactivate previous versions and create new one", async () => {
      repo.updateMany.mockResolvedValue({ count: 1 });
      repo.create.mockResolvedValue(createRecord({ version: 2 }));

      const manifest = createManifest({ version: 2 });
      const result = await store.save(manifest);

      expect(repo.updateMany).toHaveBeenCalledWith({
        where: {
          regionId: "california",
          sourceUrl: "https://example.com",
          dataType: "propositions",
          isActive: true,
        },
        data: { isActive: false },
      });
      expect(repo.create).toHaveBeenCalled();
      expect(result.version).toBe(2);
    });

    it("should set successCount and failureCount to 0 for new versions", async () => {
      repo.updateMany.mockResolvedValue({ count: 0 });
      repo.create.mockResolvedValue(createRecord());

      await store.save(createManifest());

      const createCall = repo.create.mock.calls[0][0];
      expect(createCall.data.successCount).toBe(0);
      expect(createCall.data.failureCount).toBe(0);
    });
  });

  describe("incrementSuccess", () => {
    it("should increment success count and update lastUsedAt", async () => {
      repo.findFirst.mockResolvedValue(createRecord({ successCount: 5 }));
      repo.update.mockResolvedValue(createRecord({ successCount: 6 }));

      await store.incrementSuccess("manifest-1");

      expect(repo.update).toHaveBeenCalledWith({
        where: { id: "manifest-1" },
        data: expect.objectContaining({ successCount: 6 }),
      });
    });

    it("should do nothing if manifest not found", async () => {
      repo.findFirst.mockResolvedValue(null);

      await store.incrementSuccess("nonexistent");

      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("incrementFailure", () => {
    it("should increment failure count", async () => {
      repo.findFirst.mockResolvedValue(createRecord({ failureCount: 2 }));
      repo.update.mockResolvedValue(createRecord({ failureCount: 3 }));

      await store.incrementFailure("manifest-1");

      expect(repo.update).toHaveBeenCalledWith({
        where: { id: "manifest-1" },
        data: { failureCount: 3 },
      });
    });

    it("should do nothing if manifest not found", async () => {
      repo.findFirst.mockResolvedValue(null);

      await store.incrementFailure("nonexistent");

      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("getHistory", () => {
    it("should return manifest history ordered by version desc", async () => {
      repo.findMany.mockResolvedValue([
        createRecord({ version: 3 }),
        createRecord({ version: 2 }),
        createRecord({ version: 1 }),
      ]);

      const history = await store.getHistory(
        "california",
        "https://example.com",
        DataType.PROPOSITIONS,
      );

      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(3);
      expect(repo.findMany).toHaveBeenCalledWith({
        where: {
          regionId: "california",
          sourceUrl: "https://example.com",
          dataType: "propositions",
        },
        orderBy: { version: "desc" },
        take: 10,
      });
    });

    it("should respect custom limit", async () => {
      repo.findMany.mockResolvedValue([createRecord()]);

      await store.getHistory(
        "california",
        "https://example.com",
        DataType.PROPOSITIONS,
        5,
      );

      expect(repo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe("markChecked", () => {
    it("should update lastCheckedAt timestamp", async () => {
      repo.update.mockResolvedValue(createRecord());

      await store.markChecked("manifest-1");

      expect(repo.update).toHaveBeenCalledWith({
        where: { id: "manifest-1" },
        data: { lastCheckedAt: expect.any(Date) },
      });
    });
  });
});
