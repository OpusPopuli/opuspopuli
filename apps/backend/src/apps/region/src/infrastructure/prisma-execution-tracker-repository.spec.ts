import { PrismaExecutionTrackerRepository } from './prisma-execution-tracker-repository';
import type { DbService } from '@opuspopuli/relationaldb-provider';

function makeDb(): jest.Mocked<
  Pick<DbService, 'pipelineExecution' | 'pipelineExecutionBatch'>
> {
  return {
    pipelineExecution: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<DbService['pipelineExecution']>,
    pipelineExecutionBatch: {
      findMany: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<DbService['pipelineExecutionBatch']>,
  };
}

describe('PrismaExecutionTrackerRepository', () => {
  let db: ReturnType<typeof makeDb>;
  let repo: PrismaExecutionTrackerRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new PrismaExecutionTrackerRepository(db as unknown as DbService);
  });

  describe('findExecution', () => {
    it('returns null when no row matches', async () => {
      (db.pipelineExecution.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await repo.findExecution('job-1', 'https://example.com');
      expect(result).toBeNull();
      expect(db.pipelineExecution.findFirst).toHaveBeenCalledWith({
        where: { pipelineJobId: 'job-1', sourceUrl: 'https://example.com' },
        select: { id: true },
      });
    });

    it('returns the execution record when found', async () => {
      (db.pipelineExecution.findFirst as jest.Mock).mockResolvedValue({
        id: 'exec-1',
      });
      const result = await repo.findExecution('job-1', 'https://example.com');
      expect(result).toEqual({ id: 'exec-1' });
    });
  });

  describe('createExecution', () => {
    it('inserts a row with status=running and returns the id', async () => {
      (db.pipelineExecution.create as jest.Mock).mockResolvedValue({
        id: 'exec-new',
      });
      const result = await repo.createExecution({
        pipelineJobId: 'job-1',
        regionId: 'california',
        sourceUrl: 'https://example.com',
        dataType: 'campaign_finance',
      });
      expect(result).toEqual({ id: 'exec-new' });
      expect(db.pipelineExecution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'running',
          pipelineJobId: 'job-1',
        }),
        select: { id: true },
      });
    });
  });

  describe('updateExecutionStatus', () => {
    it('updates the status column', async () => {
      (db.pipelineExecution.update as jest.Mock).mockResolvedValue({});
      await repo.updateExecutionStatus('exec-1', 'completed');
      expect(db.pipelineExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: { status: 'completed' },
      });
    });
  });

  describe('findAppliedBatches', () => {
    it('returns batch indexes for the given execution', async () => {
      (db.pipelineExecutionBatch.findMany as jest.Mock).mockResolvedValue([
        { batchIndex: 0 },
        { batchIndex: 2 },
      ]);
      const result = await repo.findAppliedBatches('exec-1');
      expect(result).toEqual([{ batchIndex: 0 }, { batchIndex: 2 }]);
      expect(db.pipelineExecutionBatch.findMany).toHaveBeenCalledWith({
        where: { executionId: 'exec-1' },
        select: { batchIndex: true },
      });
    });
  });

  describe('createBatch', () => {
    it('inserts a batch row', async () => {
      (db.pipelineExecutionBatch.create as jest.Mock).mockResolvedValue({});
      await repo.createBatch('exec-1', 3, 100);
      expect(db.pipelineExecutionBatch.create).toHaveBeenCalledWith({
        data: { executionId: 'exec-1', batchIndex: 3, itemCount: 100 },
      });
    });
  });

  describe('finalizeExecution', () => {
    it('marks completed with correct stats', async () => {
      (db.pipelineExecution.update as jest.Mock).mockResolvedValue({});
      await repo.finalizeExecution('exec-1', true, {
        itemsExtracted: 500,
        itemsFailed: 0,
        extractionTimeMs: 12000,
      });
      expect(db.pipelineExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: expect.objectContaining({
          success: true,
          status: 'completed',
          itemsExtracted: 500,
        }),
      });
    });

    it('marks failed with correct status', async () => {
      (db.pipelineExecution.update as jest.Mock).mockResolvedValue({});
      await repo.finalizeExecution('exec-1', false, {
        itemsExtracted: 50,
        itemsFailed: 5,
        extractionTimeMs: 3000,
      });
      expect(db.pipelineExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: expect.objectContaining({ success: false, status: 'failed' }),
      });
    });
  });
});
