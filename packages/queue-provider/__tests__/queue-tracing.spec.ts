import { Test } from "@nestjs/testing";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { QueueService } from "../src/queue.service";
import { JOB_TRACE_KEY } from "../src/job-tracing";
import { QUEUE_CONNECTION, QUEUE_MODULE_OPTIONS } from "../src/queue.constants";

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: "job-123" }),
  addBulk: jest.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]),
  getJob: jest.fn(),
  upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  getJobSchedulers: jest.fn().mockResolvedValue([]),
  removeJobScheduler: jest.fn().mockResolvedValue(true),
  close: jest.fn().mockResolvedValue(undefined),
};
jest.mock("bullmq", () => ({ Queue: jest.fn(() => mockQueue) }));

/**
 * What the ENQUEUE path puts on the wire (M3 / D7).
 *
 * Separate from `job-tracing.spec.ts`, which proves the trace joins up: this
 * one proves which call sites opt in, and — the part that actually bites —
 * which one must not.
 */
describe("QueueService trace propagation (M3)", () => {
  let service: QueueService;
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
  });

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
    propagation.disable();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    exporter.reset();
    const module = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: QUEUE_CONNECTION, useValue: { quit: jest.fn() } },
        {
          provide: QUEUE_MODULE_OPTIONS,
          useValue: { url: "redis://localhost:6379", prefix: "test" },
        },
      ],
    }).compile();
    service = module.get(QueueService);
  });

  /** Run `fn` inside an active span, as a GraphQL resolver would. */
  const inRequest = async (fn: () => Promise<unknown>): Promise<void> => {
    await trace
      .getTracer("test")
      .startActiveSpan("graphql.request", async (span) => {
        await fn();
        span.end();
      });
  };

  it("enqueue puts the caller's trace context in the job data", async () => {
    await inRequest(() =>
      service.enqueue("region-sync", { regionId: "ca" }, { jobId: "j1" }),
    );

    const [, data, opts] = mockQueue.add.mock.calls[0];
    expect(data[JOB_TRACE_KEY].traceparent).toMatch(/^00-[0-9a-f]{32}-/);
    expect(data.regionId).toBe("ca");
    // The options are untouched — dedup still works off the caller's jobId.
    expect(opts.jobId).toBe("j1");
  });

  it("enqueueBulk puts the SAME context on every job in the batch", async () => {
    // A fan-out is one decision; N unrelated traces would hide that.
    await inRequest(() =>
      service.enqueueBulk("llm-rerank", [
        { data: { userId: "1" } },
        { data: { userId: "2" } },
      ]),
    );

    const [jobs] = mockQueue.addBulk.mock.calls[0];
    const parents = jobs.map(
      (j: { data: Record<string, Record<string, string>> }) =>
        j.data[JOB_TRACE_KEY].traceparent,
    );
    expect(parents[0]).toMatch(/^00-[0-9a-f]{32}-/);
    expect(parents[1]).toBe(parents[0]);
    expect(
      jobs.map((j: { data: { userId: string } }) => j.data.userId),
    ).toEqual(["1", "2"]);
  });

  it("upsertScheduler stores NO trace context", async () => {
    // The hazard this test exists for. BullMQ keeps a scheduler's `data` and
    // replays it on every firing, so an injected `traceparent` would make
    // every nightly sync for the life of the scheduler a child of this one
    // upsert — one trace growing without bound, parented to a span that
    // ended months ago. A cron firing has to be its own trace root.
    await inRequest(() =>
      service.upsertScheduler("region-sync", "nightly", "0 2 * * *", {
        regionId: "ca",
      }),
    );

    const [, , payload] = mockQueue.upsertJobScheduler.mock.calls[0];
    expect(payload.data).toEqual({ regionId: "ca" });
    expect(JOB_TRACE_KEY in payload.data).toBe(false);
  });

  it("emits a producer span so the queue hop is visible", async () => {
    await inRequest(() => service.enqueue("region-sync", { regionId: "ca" }));

    const publish = exporter
      .getFinishedSpans()
      .find((s) => s.name === "region-sync publish");
    expect(publish).toBeDefined();
    expect(publish!.attributes["messaging.message.id"]).toBe("job-123");
  });

  it("still traces an enqueue with no surrounding request", async () => {
    // Not what I first expected: the publish span wraps the inject, so even
    // outside a request there IS an active context and the job carries one.
    // That is the right behaviour — a boot-time or cron-triggered enqueue
    // becomes its own trace root rather than an untraced hole — but it does
    // mean "no request" never means "no carrier" once an SDK is registered.
    const id = await service.enqueue("region-sync", { regionId: "ca" });

    expect(id).toBe("job-123");
    const [, data] = mockQueue.add.mock.calls[0];
    expect(data.regionId).toBe("ca");

    const publish = exporter
      .getFinishedSpans()
      .find((s) => s.name === "region-sync publish")!;
    // Root of its own trace, and the job points at it.
    expect(publish.parentSpanContext).toBeUndefined();
    expect(data[JOB_TRACE_KEY].traceparent).toContain(
      publish.spanContext().traceId,
    );
  });
});
