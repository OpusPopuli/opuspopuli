import {
  DEFAULT_QUEUE_PREFIX,
  resolveQueuePrefix,
} from "../src/queue.constants";

/**
 * One namespace, one definition.
 *
 * This string was written independently in nine places — the provider, the
 * config provider, two feature modules and five worker processors. A producer
 * and consumer that disagree here do not error: the enqueue succeeds and the
 * job is simply never seen.
 *
 * It did disagree. On 2026-09-22 the dev Redis held both `bullmq:region-sync:*`
 * (what the workers consume) and `bull:region-sync:*` — BullMQ's own library
 * default, left by an older image — with a job stranded in the second since
 * 2026-09-11.
 */
describe("queue prefix", () => {
  it("is not BullMQ's own default, which is the whole reason it must agree", () => {
    // If this were "bull", a call site that forgot to pass the prefix would
    // still land in the right namespace and the bug would be invisible.
    expect(DEFAULT_QUEUE_PREFIX).not.toBe("bull");
    expect(DEFAULT_QUEUE_PREFIX).toBe("bullmq");
  });

  it("falls back to the shared default when unset", () => {
    expect(resolveQueuePrefix(undefined)).toBe(DEFAULT_QUEUE_PREFIX);
    expect(resolveQueuePrefix(null)).toBe(DEFAULT_QUEUE_PREFIX);
  });

  it("treats blank configuration as unset rather than as an empty namespace", () => {
    // `?? DEFAULT` would have accepted "" and produced un-prefixed keys —
    // a third namespace, and the least visible one.
    expect(resolveQueuePrefix("")).toBe(DEFAULT_QUEUE_PREFIX);
    expect(resolveQueuePrefix("   ")).toBe(DEFAULT_QUEUE_PREFIX);
  });

  it("honours a deliberate override", () => {
    expect(resolveQueuePrefix("tenant-a")).toBe("tenant-a");
    expect(resolveQueuePrefix("  tenant-a  ")).toBe("tenant-a");
  });
});
