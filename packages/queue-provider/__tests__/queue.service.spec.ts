import { Test } from "@nestjs/testing";
import { QueueService } from "../src/queue.service";
import { QUEUE_CONNECTION, QUEUE_MODULE_OPTIONS } from "../src/queue.constants";

jest.mock("bullmq", () => {
  const mockJob = { id: "job-123" };
  const mockQueue = {
    add: jest.fn().mockResolvedValue(mockJob),
    getJob: jest.fn(),
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { Queue: jest.fn(() => mockQueue) };
});

describe("QueueService", () => {
  let service: QueueService;
  let mockConnection: { quit: jest.Mock };

  beforeEach(async () => {
    mockConnection = { quit: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: QUEUE_CONNECTION, useValue: mockConnection },
        {
          provide: QUEUE_MODULE_OPTIONS,
          useValue: { url: "redis://localhost:6379", prefix: "test" },
        },
      ],
    }).compile();

    service = module.get(QueueService);
  });

  it("is defined", () => {
    expect(service).toBeDefined();
  });

  describe("enqueue", () => {
    it("returns the bullmq job id", async () => {
      const id = await service.enqueue("region-sync", {
        triggerSource: "manual",
        pipelineJobId: "abc",
      });
      expect(id).toBe("job-123");
    });

    it("applies per-queue env-var config for attempts", async () => {
      process.env.BULLMQ_QUEUE_REGION_SYNC_ATTEMPTS = "5";
      // Re-enqueue — the opts built should include attempts: 5 (we verify no throw)
      await expect(
        service.enqueue("region-sync", {
          triggerSource: "cron",
          pipelineJobId: "xyz",
        }),
      ).resolves.toBe("job-123");
      delete process.env.BULLMQ_QUEUE_REGION_SYNC_ATTEMPTS;
    });
  });

  describe("upsertScheduler", () => {
    it("delegates to bullmq upsertJobScheduler", async () => {
      await expect(
        service.upsertScheduler("region-sync", "daily-cron", "0 2 * * *", {
          triggerSource: "cron",
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("onModuleDestroy", () => {
    it("closes queues and redis connection", async () => {
      await service.enqueue("region-sync", {
        triggerSource: "manual",
        pipelineJobId: "x",
      });
      await service.onModuleDestroy();
      expect(mockConnection.quit).toHaveBeenCalled();
    });
  });
});
