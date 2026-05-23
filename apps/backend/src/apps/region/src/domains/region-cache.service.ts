import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ICache } from '@opuspopuli/common';
import { REGION_CACHE } from './region.tokens';

@Injectable()
export class RegionCacheService {
  private readonly logger = new Logger(RegionCacheService.name, {
    timestamp: true,
  });

  constructor(@Inject(REGION_CACHE) private readonly cache: ICache<string>) {}

  async cachedQuery<T>(key: string, queryFn: () => Promise<T>): Promise<T> {
    const cached = await this.cache.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
    const result = await queryFn();
    await this.cache.set(key, JSON.stringify(result));
    return result;
  }

  async invalidateCache(prefix: string): Promise<void> {
    const allKeys = await this.cache.keys();
    const matching = allKeys.filter((k) => k.startsWith(prefix));
    for (const k of matching) {
      await this.cache.delete(k);
    }
    if (matching.length > 0) {
      this.logger.log(
        `Invalidated ${matching.length} cache key(s) with prefix "${prefix}"`,
      );
    }
  }

  async destroy(): Promise<void> {
    await this.cache.destroy();
  }
}
