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
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 3,
      prioritized: 1,
      active: 2,
      delayed: 0,
      failed: 5,
    }),
    getJobs: jest.fn().mockResolvedValue([{ timestamp: 1_000 }]),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { Queue: jest.fn(() => mockQueue) };
});

describe("QueueService", () => {
  let service: QueueService;
  let mockConnection: { quit: jest.Mock; scan: jest.Mock };

  beforeEach(async () => {
    mockConnection = {
      quit: jest.fn().mockResolvedValue(undefined),
      scan: jest.fn(),
    };

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

  describe("listQueueNames", () => {
    it("reads every queue under the prefix from Redis, across scan pages", async () => {
      mockConnection.scan
        .mockResolvedValueOnce(["7", ["test:region-sync:meta"]])
        .mockResolvedValueOnce([
          "0",
          ["test:pdf-parse:meta", "test:llm-lane.gpu-11434:meta"],
        ]);

      await expect(service.listQueueNames()).resolves.toEqual([
        "llm-lane.gpu-11434",
        "pdf-parse",
        "region-sync",
      ]);
      expect(mockConnection.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "test:*:meta",
        "COUNT",
        500,
      );
    });
  });

  describe("job options", () => {
    const lastAddOpts = () => {
      const { Queue } = jest.requireMock("bullmq");
      const queue = Queue.mock.results.at(-1).value;
      return queue.add.mock.calls.at(-1)[2];
    };

    it("gives pdf-parse one attempt — a failed parse is deterministic", async () => {
      await service.enqueue("pdf-parse", { sourceVersionId: "sv" });
      expect(lastAddOpts().attempts).toBe(1);
    });

    it("keeps three attempts elsewhere, and the env override wins", async () => {
      await service.enqueue("civics-extract", { pageUrl: "u" });
      expect(lastAddOpts().attempts).toBe(3);

      process.env.BULLMQ_QUEUE_PDF_PARSE_ATTEMPTS = "2";
      await service.enqueue("pdf-parse", { sourceVersionId: "sv" });
      expect(lastAddOpts().attempts).toBe(2);
      delete process.env.BULLMQ_QUEUE_PDF_PARSE_ATTEMPTS;
    });
  });

  describe("getDepth", () => {
    const queueMock = () => {
      const { Queue } = jest.requireMock("bullmq");
      return Queue.mock.results.at(-1).value;
    };

    it("takes the older of the two list heads, not the first list's", async () => {
      await service.getDepth("pdf-parse", 0); // creates the queue
      queueMock()
        .getJobs.mockResolvedValueOnce([{ timestamp: 50_000 }])
        .mockResolvedValueOnce([{ timestamp: 20_000 }]);

      const depth = await service.getDepth("pdf-parse", 80_000);
      expect(depth.oldestWaitingSeconds).toBe(60);
    });

    it("ages a retried job from its last start, not its creation", async () => {
      await service.getDepth("pdf-parse", 0);
      queueMock()
        .getJobs.mockResolvedValueOnce([
          { timestamp: 1_000, processedOn: 70_000 },
        ])
        .mockResolvedValueOnce([]);

      const depth = await service.getDepth("pdf-parse", 80_000);
      expect(depth.oldestWaitingSeconds).toBe(10);
    });

    it("counts prioritized jobs as waiting and ages the oldest one", async () => {
      await expect(service.getDepth("pdf-parse", 61_000)).resolves.toEqual({
        waiting: 4,
        active: 2,
        delayed: 0,
        failed: 5,
        oldestWaitingSeconds: 60,
      });
    });
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

    it("drops a job on finish only when asked, leaving the queue's retention otherwise", async () => {
      const { Queue } = jest.requireMock("bullmq") as { Queue: jest.Mock };
      const queue = Queue.mock.results[0]?.value ?? new Queue();
      queue.add.mockClear();

      await service.enqueue("civics-extract", {}, { jobId: "a" });
      await service.enqueue(
        "civics-extract",
        {},
        { jobId: "b", removeOnFinish: true },
      );

      const [[, , kept], [, , dropped]] = queue.add.mock.calls;
      expect(kept).not.toHaveProperty("removeOnComplete");
      expect(dropped).toMatchObject({
        removeOnComplete: true,
        removeOnFail: true,
      });
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
