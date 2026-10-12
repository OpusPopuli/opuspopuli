import {
  OPTIONAL_DEPS_METADATA,
  PARAMTYPES_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from "@nestjs/common/constants";
import { ScrapingPipelineService } from "../src/pipeline/pipeline.service.js";
import { ExecutionTrackerService } from "../src/pipeline/execution-tracker.service.js";

/**
 * Guards the DI wiring of the execution tracker (#1280).
 *
 * Every other test of this service constructs it with `new` and positional
 * arguments, which is why the defect this file guards survived: it existed
 * only in Nest's container resolution, and direct construction cannot see it.
 *
 * The trap: `executionTracker` is annotated `ExecutionTrackerService | null`,
 * and TypeScript emits `Object` as the `design:paramtypes` entry for ANY union
 * type. With `@Optional()` and no `@Inject`, Nest therefore resolves a token of
 * `Object`, finds no provider, injects undefined, and the `= null` default
 * takes over — so the pipeline ran with tracking silently off and every data
 * type except campaign_finance recorded zero executions. (The bulk and api
 * handlers escaped because the module constructs them by hand with the tracker
 * passed explicitly.)
 *
 * Measured on the live corpus before the fix: `pipeline_executions` held 30
 * rows, all campaign_finance, while 56 propositions and 197 claims carried a
 * null `pipeline_execution_id`.
 */
describe("ScrapingPipelineService execution-tracker injection", () => {
  const paramTypes: unknown[] =
    Reflect.getMetadata(PARAMTYPES_METADATA, ScrapingPipelineService) ?? [];
  const selfDeclared: Array<{ index: number; param: unknown }> =
    Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, ScrapingPipelineService) ??
    [];
  const optionalIndexes: number[] =
    Reflect.getMetadata(OPTIONAL_DEPS_METADATA, ScrapingPipelineService) ?? [];

  // The tracker is the last constructor parameter.
  const trackerIndex = paramTypes.length - 1;

  it("emits Object for the tracker's type, so the type alone cannot resolve it", () => {
    // This is the premise of the whole test, asserted rather than assumed: if a
    // future refactor drops the `| null` from the annotation, the emitted type
    // becomes the class, this assertion fails, and whoever is reading knows the
    // explicit @Inject below is no longer load-bearing.
    expect(paramTypes[trackerIndex]).toBe(Object);
  });

  it("declares an explicit @Inject token for the tracker", () => {
    const declared = selfDeclared.find((d) => d.index === trackerIndex);
    expect(declared).toBeDefined();
    expect(declared?.param).toBe(ExecutionTrackerService);
  });

  it("keeps the tracker optional, so the pipeline still runs unwired", () => {
    // The fix must not turn a missing tracker into a boot failure: the service
    // is deliberately usable with tracking off, and beginSession warns in that
    // case rather than throwing.
    expect(optionalIndexes).toContain(trackerIndex);
  });
});
