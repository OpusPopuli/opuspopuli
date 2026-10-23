import { Logger } from "@nestjs/common";
import { Worker } from "bullmq";
import { createWorker } from "../src/worker.factory";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));
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
      "llm-lane-host.docker.internal-11434",
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
});
