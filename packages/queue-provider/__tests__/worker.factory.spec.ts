import { Logger } from "@nestjs/common";
import { Worker } from "bullmq";
import {
  createWorker,
  queueConcurrency,
  setDefaultWorkerMetrics,
  workerQueueSelected,
} from "../src/worker.factory";

jest.mock("bullmq", () => {
  class DelayedError extends Error {}
  return {
    DelayedError,
    Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  };
});
jest.mock("../src/job-tracing", () => ({
  withJobSpan: (_q: string, _j: unknown, fn: () => unknown) => fn(),
}));

/**
 * The caller overrides added for S7's lane queues, whose dotted names make
 * the `BULLMQ_QUEUE_<NAME>_*` env knobs unexportable from a shell.
 */
describe("createWorker — caller overrides", () => {
  const connection = {} as never;
  const workerOptions = () =>
    (Worker as unknown as jest.Mock).mock.calls.at(-1)[2];
  const processor = () =>
    (Worker as unknown as jest.Mock).mock.calls.at(-1)[1] as (
      job: unknown,
      token?: string,
    ) => Promise<unknown>;
  const job = { id: "1", attemptsMade: 0, opts: {}, data: {} };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps the env defaults when nothing is overridden", () => {
    createWorker("plain", connection, async () => undefined);

    expect(workerOptions()).toEqual(
      expect.objectContaining({ concurrency: 1, lockDuration: 300000 }),
    );
    // BullMQ's own default (1) applies: the key is absent, not undefined.
    expect(workerOptions()).not.toHaveProperty("maxStalledCount");
  });

  it("passes concurrency, lock duration and stall count through", () => {
    createWorker(
      "gpu-lane-host.docker.internal-11434",
      connection,
      async () => undefined,
      {
        concurrency: 2,
        lockDuration: 60000,
        maxStalledCount: 0,
      },
    );

    expect(workerOptions()).toEqual(
      expect.objectContaining({
        concurrency: 2,
        lockDuration: 60000,
        maxStalledCount: 0,
      }),
    );
  });

  it("logs success at debug when quiet", async () => {
    createWorker("quiet", connection, async () => "ok", { quiet: true });
    await processor()(job);

    expect(Logger.prototype.debug).toHaveBeenCalledWith(
      expect.anything(),
      "Job succeeded",
    );
    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it("logs success at log otherwise", async () => {
    createWorker("loud", connection, async () => "ok");
    await processor()(job);

    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.anything(),
      "Job succeeded",
    );
  });

  it("hands the handler its lock token, and treats a delay as no failure (S2)", async () => {
    const { DelayedError } = jest.requireMock("bullmq");
    const metrics = {
      incrementJobAttempts: jest.fn(),
      recordJobDuration: jest.fn(),
    };
    const error = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    const handler = jest.fn(async () => {
      throw new DelayedError();
    });
    createWorker("waits", connection, handler, { metrics });

    await expect(processor()(job, "lock-token")).rejects.toBeInstanceOf(
      DelayedError,
    );

    expect(handler).toHaveBeenCalledWith(job, "lock-token");
    expect(error).not.toHaveBeenCalled();
    expect(metrics.incrementJobAttempts).not.toHaveBeenCalled();
  });
});

describe("createWorker — default job metrics", () => {
  const processor = () =>
    (Worker as unknown as jest.Mock).mock.calls.at(-1)[1] as (
      job: unknown,
    ) => Promise<unknown>;
  const job = {
    id: "j1",
    attemptsMade: 0,
    opts: { attempts: 1 },
    data: { triggerSource: "cron" },
  };
  const metrics = () => ({
    incrementJobAttempts: jest.fn(),
    recordJobDuration: jest.fn(),
  });

  afterEach(() => setDefaultWorkerMetrics(undefined));

  it("reports to the process default when the caller passes none", async () => {
    const bound = metrics();
    setDefaultWorkerMetrics(bound);
    createWorker("measured", {} as never, async () => "ok");
    await processor()(job);

    expect(bound.incrementJobAttempts).toHaveBeenCalledWith(
      "measured",
      "cron",
      "success",
    );
    expect(bound.recordJobDuration).toHaveBeenCalledWith(
      "measured",
      "cron",
      expect.any(Number),
    );
  });

  it("prefers the caller's own metrics over the default", async () => {
    const bound = metrics();
    const own = metrics();
    setDefaultWorkerMetrics(bound);
    createWorker("own", {} as never, async () => "ok", { metrics: own });
    await processor()(job);

    expect(own.incrementJobAttempts).toHaveBeenCalled();
    expect(bound.incrementJobAttempts).not.toHaveBeenCalled();
  });
});

/** The role switch that makes multi-host a configuration change. */
describe("workerQueueSelected (WORKER_QUEUES)", () => {
  it.each([
    [undefined, "pdf-parse", true],
    ["", "region-sync", true],
    ["*", "region-sync", true],
    ["pdf-parse", "pdf-parse", true],
    ["pdf-parse", "region-sync", false],
    ["*,!pdf-parse", "pdf-parse", false],
    ["*,!pdf-parse", "region-sync", true],
    ["gpu-lane-*", "gpu-lane-host.docker.internal-11434", true],
    ["*,!gpu-lane-*", "gpu-lane-host.docker.internal-11434", false],
    [" pdf-parse , civics-extract ", "civics-extract", true],
  ])("WORKER_QUEUES=%p → %s consumed here: %p", (spec, queue, expected) => {
    expect(workerQueueSelected(queue, spec)).toBe(expected);
  });
});

describe("queueConcurrency", () => {
  afterEach(() => {
    delete process.env.BULLMQ_QUEUE_PDF_PARSE_CONCURRENCY;
  });

  it.each([
    [undefined, 1],
    ["3", 3],
    ["0", 1],
    ["-2", 1],
    ["lots", 1],
  ])("reads %p as %p", (value, expected) => {
    if (value !== undefined)
      process.env.BULLMQ_QUEUE_PDF_PARSE_CONCURRENCY = value;
    expect(queueConcurrency("pdf-parse")).toBe(expected);
  });
});

describe("createWorker — a queue switched off everywhere", () => {
  afterEach(() => {
    delete process.env.BULLMQ_QUEUE_OFF_ENABLED;
  });

  it("does not run, and says the queue is disabled", () => {
    process.env.BULLMQ_QUEUE_OFF_ENABLED = "false";
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    createWorker("off", {} as never, async () => "ok");
    const opts = (Worker as unknown as jest.Mock).mock.calls.at(-1)[2];
    expect(opts.autorun).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });
});

describe("createWorker — a queue this process does not consume", () => {
  afterEach(() => {
    delete process.env.WORKER_QUEUES;
    jest.restoreAllMocks();
  });

  it("starts the worker without running it, and says another process owns it", () => {
    process.env.WORKER_QUEUES = "*,!pdf-parse";
    const log = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => {});

    createWorker("pdf-parse", {} as never, async () => undefined);

    expect((Worker as unknown as jest.Mock).mock.calls.at(-1)[2]).toEqual(
      expect.objectContaining({ autorun: false }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("WORKER_QUEUES"));
  });
});
