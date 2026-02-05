import { Injectable, Inject, Logger } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { HealthModuleOptions } from '../health.module';

/**
 * Default memory thresholds
 */
const DEFAULT_HEAP_THRESHOLD = 150 * 1024 * 1024; // 150MB
const DEFAULT_RSS_THRESHOLD = 300 * 1024 * 1024; // 300MB

/**
 * Memory Health Indicator
 *
 * Checks memory usage against configurable thresholds.
 * Helps detect memory leaks and prevents OOM kills.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/209
 */
@Injectable()
export class MemoryHealthIndicator {
  private readonly logger = new Logger(MemoryHealthIndicator.name);
  private readonly heapThreshold: number;
  private readonly rssThreshold: number;

  constructor(
    @Inject('HEALTH_OPTIONS')
    options: HealthModuleOptions,
  ) {
    this.heapThreshold = options.memoryHeapThreshold ?? DEFAULT_HEAP_THRESHOLD;
    this.rssThreshold = options.memoryRssThreshold ?? DEFAULT_RSS_THRESHOLD;
  }

  /**
   * Check memory usage
   *
   * Reports heap and RSS memory usage and status.
   * Status is 'up' if within thresholds, 'down' if exceeded.
   *
   * @returns Health indicator result with memory status
   */
  async check(): Promise<HealthIndicatorResult> {
    const key = 'memory';
    const memoryUsage = process.memoryUsage();

    const heapUsed = memoryUsage.heapUsed;
    const rss = memoryUsage.rss;

    const isHealthy = heapUsed < this.heapThreshold && rss < this.rssThreshold;

    if (!isHealthy) {
      this.logger.warn(
        `Memory usage exceeds threshold: heap=${this.formatBytes(heapUsed)}/${this.formatBytes(this.heapThreshold)}, ` +
          `rss=${this.formatBytes(rss)}/${this.formatBytes(this.rssThreshold)}`,
      );
    }

    return {
      [key]: {
        status: isHealthy ? 'up' : 'down',
        heapUsed: this.formatBytes(heapUsed),
        heapTotal: this.formatBytes(memoryUsage.heapTotal),
        rss: this.formatBytes(rss),
        external: this.formatBytes(memoryUsage.external),
        heapThreshold: this.formatBytes(this.heapThreshold),
        rssThreshold: this.formatBytes(this.rssThreshold),
      },
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)}MB`;
  }
}
