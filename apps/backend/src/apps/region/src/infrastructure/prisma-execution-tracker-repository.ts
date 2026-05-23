import { Injectable } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type {
  ExecutionTrackerRepository,
  ExecutionRecord,
  ExecutionStatus,
} from '@opuspopuli/scraping-pipeline';

@Injectable()
export class PrismaExecutionTrackerRepository implements ExecutionTrackerRepository {
  constructor(private readonly db: DbService) {}

  async findExecution(
    pipelineJobId: string,
    sourceUrl: string,
  ): Promise<ExecutionRecord | null> {
    return this.db.pipelineExecution.findFirst({
      where: { pipelineJobId, sourceUrl },
      select: { id: true },
    });
  }

  async createExecution(args: {
    pipelineJobId: string;
    regionId: string;
    sourceUrl: string;
    dataType: string;
  }): Promise<ExecutionRecord> {
    return this.db.pipelineExecution.create({
      data: {
        regionId: args.regionId,
        sourceUrl: args.sourceUrl,
        dataType: args.dataType,
        pipelineJobId: args.pipelineJobId,
        status: 'running',
      },
      select: { id: true },
    });
  }

  async updateExecutionStatus(
    id: string,
    status: ExecutionStatus,
  ): Promise<void> {
    await this.db.pipelineExecution.update({
      where: { id },
      data: { status },
    });
  }

  async findAppliedBatches(
    executionId: string,
  ): Promise<{ batchIndex: number }[]> {
    return this.db.pipelineExecutionBatch.findMany({
      where: { executionId },
      select: { batchIndex: true },
    });
  }

  async createBatch(
    executionId: string,
    batchIndex: number,
    itemCount: number,
  ): Promise<void> {
    await this.db.pipelineExecutionBatch.create({
      data: { executionId, batchIndex, itemCount },
    });
  }

  async finalizeExecution(
    id: string,
    success: boolean,
    stats: {
      itemsExtracted: number;
      itemsFailed: number;
      extractionTimeMs: number;
    },
  ): Promise<void> {
    await this.db.pipelineExecution.update({
      where: { id },
      data: {
        success,
        status: success ? 'completed' : 'failed',
        itemsExtracted: stats.itemsExtracted,
        itemsFailed: stats.itemsFailed,
        extractionTimeMs: stats.extractionTimeMs,
      },
    });
  }
}
