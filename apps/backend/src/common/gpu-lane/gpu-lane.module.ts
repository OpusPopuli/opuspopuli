import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GPU_LANE_DISPATCHER } from '@opuspopuli/common';
import { QueueModule, resolveQueuePrefix } from '@opuspopuli/queue-provider';
import {
  GPU_LANE_OPTIONS,
  GpuLaneDispatcher,
  type GpuLaneOptions,
} from './gpu-lane.dispatcher';

const DEFAULT_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * The lane queue for batch inference (S7, `docs/plans/S7-gpu-lane-queue.md`).
 *
 * Imported ONLY by the worker app modules — region-worker,
 * structural-analysis-worker, llm-rerank-worker — which is what makes their
 * inference batch and everything else's interactive: `LLMModule` routes
 * through the dispatcher when one is bound, and an API process binds none.
 *
 * Global, so `LLMModule` resolves the dispatcher from inside its own scope
 * however deeply it is imported — the same reason the metrics observer is.
 *
 * **Inert unless `GPU_LANE_QUEUE_ENABLED=true`**, as Phase A's "merged to
 * main, inert" asks: off, nothing is bound and every call is direct.
 */
@Global()
@Module({})
export class GpuLaneModule {
  private static readonly logger = new Logger(GpuLaneModule.name);

  static forRoot(): DynamicModule {
    if (process.env.GPU_LANE_QUEUE_ENABLED !== 'true') {
      this.logger.log(
        'GPU lane queue off (GPU_LANE_QUEUE_ENABLED is not "true"): batch ' +
          'inference calls Ollama directly',
      );
      return { module: GpuLaneModule };
    }
    return {
      module: GpuLaneModule,
      imports: [
        QueueModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            url: config.get('REDIS_URL') || 'redis://localhost:6379',
            prefix: resolveQueuePrefix(config.get('BULLMQ_PREFIX')),
          }),
        }),
      ],
      providers: [
        {
          provide: GPU_LANE_OPTIONS,
          inject: [ConfigService],
          useFactory: (config: ConfigService): GpuLaneOptions => ({
            prefix: resolveQueuePrefix(config.get('BULLMQ_PREFIX')),
            globalConcurrency: positiveInt(
              config.get('GPU_LANE_GLOBAL_CONCURRENCY'),
              1,
            ),
            waitTimeoutMs: positiveInt(
              config.get('GPU_LANE_WAIT_TIMEOUT_MS'),
              DEFAULT_WAIT_TIMEOUT_MS,
            ),
          }),
        },
        GpuLaneDispatcher,
        { provide: GPU_LANE_DISPATCHER, useExisting: GpuLaneDispatcher },
      ],
      exports: [GPU_LANE_DISPATCHER],
    };
  }
}

/** A positive integer from config, or the default for anything else. */
export function positiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
