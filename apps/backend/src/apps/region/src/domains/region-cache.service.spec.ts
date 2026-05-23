import { Test, TestingModule } from '@nestjs/testing';
import { RegionCacheService } from './region-cache.service';
import { REGION_CACHE } from './region.tokens';
import type { ICache } from '@opuspopuli/common';

function createMockCache(): jest.Mocked<ICache<string>> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    has: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    keys: jest.fn(),
    destroy: jest.fn(),
    size: 0,
  } as unknown as jest.Mocked<ICache<string>>;
}

describe('RegionCacheService', () => {
  let service: RegionCacheService;
  let mockCache: jest.Mocked<ICache<string>>;

  beforeEach(async () => {
    mockCache = createMockCache();
    mockCache.get.mockResolvedValue(undefined);
    mockCache.set.mockResolvedValue(undefined);
    mockCache.delete.mockResolvedValue(true);
    mockCache.keys.mockResolvedValue([]);
    mockCache.destroy.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionCacheService,
        { provide: REGION_CACHE, useValue: mockCache },
      ],
    }).compile();

    service = module.get<RegionCacheService>(RegionCacheService);
  });

  describe('cachedQuery', () => {
    it('returns the cached value on second call without calling queryFn again', async () => {
      const data = { value: 42 };
      mockCache.get.mockResolvedValueOnce(JSON.stringify(data));

      const queryFn = jest.fn().mockResolvedValue({ value: 99 });
      const result = await service.cachedQuery('test-key', queryFn);

      expect(result).toEqual(data);
      expect(queryFn).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('calls queryFn on cache miss and caches the result', async () => {
      mockCache.get.mockResolvedValue(undefined);
      const data = { items: ['a', 'b'] };
      const queryFn = jest.fn().mockResolvedValue(data);

      const result = await service.cachedQuery('miss-key', queryFn);

      expect(result).toEqual(data);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(mockCache.set).toHaveBeenCalledWith(
        'miss-key',
        JSON.stringify(data),
      );
    });
  });

  describe('invalidateCache', () => {
    it('deletes only keys with matching prefix', async () => {
      mockCache.keys.mockResolvedValue([
        'propositions:all',
        'propositions:page-1',
        'meetings:all',
      ]);

      await service.invalidateCache('propositions:');

      expect(mockCache.delete).toHaveBeenCalledTimes(2);
      expect(mockCache.delete).toHaveBeenCalledWith('propositions:all');
      expect(mockCache.delete).toHaveBeenCalledWith('propositions:page-1');
      expect(mockCache.delete).not.toHaveBeenCalledWith('meetings:all');
    });

    it('does nothing when no keys match the prefix', async () => {
      mockCache.keys.mockResolvedValue([
        'meetings:all',
        'representatives:0:10',
      ]);

      await service.invalidateCache('propositions:');

      expect(mockCache.delete).not.toHaveBeenCalled();
    });
  });
});
