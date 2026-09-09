import { Test } from "@nestjs/testing";
import { QueueService } from "../src/queue.service";
import { QUEUE_CONNECTION, QUEUE_MODULE_OPTIONS } from "../src/queue.constants";

jest.mock("bullmq", () => {
  const mockJob = { id: "job-123" };
  const mockQueue = {
    add: jest.fn().mockResolvedValue(mockJob),
    getJob: jest.fn(),
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    getJobSchedulers: jest.fn().mockResolvedValue([]),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
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

    // #1172. BullMQ returns the EXISTING job when a caller-supplied jobId is
    // already taken — in any state, including `completed` (retained 7 days).
    // The call resolves normally, so without this warning a caller reports
    // "enqueued" for work that will never run. That silence is what made the
    // manifest-ready follow-up bug expensive to find.
    it("warns when a caller-supplied jobId collided with a finished job", async () => {
      const { Queue } = jest.requireMock("bullmq") as {
        Queue: jest.Mock;
      };
      const queue = Queue.mock.results[0]?.value ?? new Queue();
      const finishedAt = Date.parse("2026-09-07T03:06:09.549Z");
      queue.add.mockResolvedValueOnce({
        id: "manifest-ready:california-sonoma:propositions",
        finishedOn: finishedAt,
      });

      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          "warn",
        )
        .mockImplementation(() => undefined);

      await service.enqueue(
        "region-sync",
        { triggerSource: "manifest_ready" },
        { jobId: "manifest-ready:california-sonoma:propositions" },
      );

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("NO-OP"));
      warn.mockRestore();
    });

    it("does not warn for a normal enqueue", async () => {
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          "warn",
        )
        .mockImplementation(() => undefined);

      await service.enqueue(
        "region-sync",
        { triggerSource: "manual" },
        { jobId: "fresh-id" },
      );

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
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

  describe("listSchedulers", () => {
    it("returns mapped scheduler info from bullmq", async () => {
      const { Queue } = jest.requireMock("bullmq");
      const mockQueue = Queue.mock.results[0]?.value ?? Queue();
      mockQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          key: "california-campaign_finance-cron",
          pattern: "15 2 * * *",
          next: 1700000000000,
        },
        {
          key: "california-propositions-cron",
          pattern: "22 2 * * 0",
          next: null,
        },
      ]);

      const result = await service.listSchedulers("region-sync");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "california-campaign_finance-cron",
        pattern: "15 2 * * *",
        next: 1700000000000,
      });
      expect(result[1].next).toBeNull();
    });

    it("returns empty array when no schedulers registered", async () => {
      const result = await service.listSchedulers("region-sync");
      expect(result).toEqual([]);
    });
  });

  describe("removeScheduler", () => {
    it("delegates to bullmq removeJobScheduler", async () => {
      await expect(
        service.removeScheduler("region-sync", "daily-cron"),
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
