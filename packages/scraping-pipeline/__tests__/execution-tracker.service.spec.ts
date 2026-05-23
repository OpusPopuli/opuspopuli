// Mock Logger — ExecutionTrackerService no longer uses NestJS DI decorators
jest.mock("@nestjs/common", () => ({
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

import {
  ExecutionTrackerService,
  type ExecutionTrackerRepository,
} from "../src/pipeline/execution-tracker.service";

function createMockRepository(): jest.Mocked<ExecutionTrackerRepository> {
  return {
    findExecution: jest.fn(),
    createExecution: jest.fn(),
    updateExecutionStatus: jest.fn(),
    findAppliedBatches: jest.fn(),
    createBatch: jest.fn(),
    finalizeExecution: jest.fn(),
  };
}

describe("ExecutionTrackerService", () => {
  let repo: jest.Mocked<ExecutionTrackerRepository>;
  let service: ExecutionTrackerService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new ExecutionTrackerService(repo);
  });

  describe("isEnabled", () => {
    it("should be true when repository is provided", () => {
      expect(service.isEnabled).toBe(true);
    });

    it("should be false when repository is null", () => {
      const disabled = new ExecutionTrackerService(null);
      expect(disabled.isEnabled).toBe(false);
    });
  });

  describe("startExecution", () => {
    const args = {
      pipelineJobId: "job-1",
      regionId: "california",
      sourceUrl: "https://example.com/data.csv",
      dataType: "campaign_finance",
    };

    it("should create a new execution row on first run and return empty appliedBatches", async () => {
      repo.findExecution.mockResolvedValue(null);
      repo.createExecution.mockResolvedValue({ id: "exec-abc" });
      repo.findAppliedBatches.mockResolvedValue([]);

      const result = await service.startExecution(args);

      expect(result.executionId).toBe("exec-abc");
      expect(result.appliedBatches.size).toBe(0);
      expect(repo.createExecution).toHaveBeenCalledWith(args);
      expect(repo.updateExecutionStatus).not.toHaveBeenCalled();
    });

    it("should find existing execution on retry and return previously applied batches", async () => {
      repo.findExecution.mockResolvedValue({ id: "exec-abc" });
      repo.findAppliedBatches.mockResolvedValue([
        { batchIndex: 0 },
        { batchIndex: 1 },
        { batchIndex: 2 },
      ]);

      const result = await service.startExecution(args);

      expect(result.executionId).toBe("exec-abc");
      expect(result.appliedBatches).toEqual(new Set([0, 1, 2]));
      expect(repo.updateExecutionStatus).toHaveBeenCalledWith(
        "exec-abc",
        "running",
      );
      expect(repo.createExecution).not.toHaveBeenCalled();
    });

    it("should look up execution by pipelineJobId and sourceUrl", async () => {
      repo.findExecution.mockResolvedValue(null);
      repo.createExecution.mockResolvedValue({ id: "exec-xyz" });
      repo.findAppliedBatches.mockResolvedValue([]);

      await service.startExecution(args);

      expect(repo.findExecution).toHaveBeenCalledWith(
        args.pipelineJobId,
        args.sourceUrl,
      );
    });

    it("should handle P2002 race on concurrent retries — re-fetch and resume", async () => {
      const conflict = Object.assign(new Error("Unique constraint"), {
        code: "P2002",
      });
      // First findExecution returns null (both retries race past it)
      repo.findExecution
        .mockResolvedValueOnce(null) // initial check: no row yet
        .mockResolvedValueOnce({ id: "exec-winner" }); // re-fetch after conflict
      repo.createExecution.mockRejectedValue(conflict);
      repo.findAppliedBatches.mockResolvedValue([{ batchIndex: 0 }]);

      const result = await service.startExecution(args);

      expect(result.executionId).toBe("exec-winner");
      expect(result.appliedBatches).toEqual(new Set([0]));
      expect(repo.updateExecutionStatus).toHaveBeenCalledWith(
        "exec-winner",
        "running",
      );
    });

    it("should rethrow non-P2002 errors from createExecution", async () => {
      repo.findExecution.mockResolvedValue(null);
      repo.createExecution.mockRejectedValue(new Error("DB connection lost"));

      await expect(service.startExecution(args)).rejects.toThrow(
        "DB connection lost",
      );
    });
  });

  describe("recordBatch", () => {
    it("should return true when batch row is inserted successfully", async () => {
      repo.createBatch.mockResolvedValue(undefined);

      const result = await service.recordBatch("exec-abc", 3, 100);

      expect(result).toBe(true);
      expect(repo.createBatch).toHaveBeenCalledWith("exec-abc", 3, 100);
    });

    it("should return false on P2002 unique constraint conflict (already applied)", async () => {
      const conflict = Object.assign(new Error("Unique constraint"), {
        code: "P2002",
      });
      repo.createBatch.mockRejectedValue(conflict);

      const result = await service.recordBatch("exec-abc", 3, 100);

      expect(result).toBe(false);
    });

    it("should rethrow unexpected errors", async () => {
      repo.createBatch.mockRejectedValue(new Error("DB connection lost"));

      await expect(service.recordBatch("exec-abc", 3, 100)).rejects.toThrow(
        "DB connection lost",
      );
    });
  });

  describe("finalizeExecution", () => {
    it("should mark execution completed with correct stats on success", async () => {
      repo.finalizeExecution.mockResolvedValue(undefined);

      await service.finalizeExecution("exec-abc", true, {
        itemsExtracted: 500,
        itemsFailed: 0,
        extractionTimeMs: 12000,
      });

      expect(repo.finalizeExecution).toHaveBeenCalledWith("exec-abc", true, {
        itemsExtracted: 500,
        itemsFailed: 0,
        extractionTimeMs: 12000,
      });
    });

    it("should mark execution failed on error", async () => {
      repo.finalizeExecution.mockResolvedValue(undefined);

      await service.finalizeExecution("exec-abc", false, {
        itemsExtracted: 200,
        itemsFailed: 0,
        extractionTimeMs: 5000,
      });

      expect(repo.finalizeExecution).toHaveBeenCalledWith(
        "exec-abc",
        false,
        expect.any(Object),
      );
    });
  });
});
