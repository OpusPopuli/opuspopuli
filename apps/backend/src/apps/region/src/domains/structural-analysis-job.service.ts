import { Injectable } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  JOB_STATUS,
  type AnalysisRequestSource,
} from '@opuspopuli/queue-provider';

export interface CreateStructuralAnalysisJobInput {
  id: string;
  bullmqJobId: string;
  regionId: string;
  sourceUrl: string;
  dataType: string;
  requestedBy: AnalysisRequestSource;
}

@Injectable()
export class StructuralAnalysisJobService {
  constructor(private readonly prisma: DbService) {}

  async create(
    input: CreateStructuralAnalysisJobInput,
  ): Promise<{ id: string }> {
    return this.prisma.structuralAnalysisJob.create({
      data: {
        id: input.id,
        bullmqJobId: input.bullmqJobId,
        regionId: input.regionId,
        sourceUrl: input.sourceUrl,
        dataType: input.dataType,
        requestedBy: input.requestedBy,
        status: JOB_STATUS.QUEUED,
      },
      select: { id: true },
    });
  }

  async markRunning(
    id: string,
    bullmqJobId: string,
    context?: {
      regionId: string;
      sourceUrl: string;
      dataType: string;
      requestedBy: AnalysisRequestSource;
    },
  ): Promise<void> {
    if (context) {
      await this.prisma.structuralAnalysisJob.upsert({
        where: { id },
        create: {
          id,
          bullmqJobId,
          regionId: context.regionId,
          sourceUrl: context.sourceUrl,
          dataType: context.dataType,
          requestedBy: context.requestedBy,
          status: JOB_STATUS.RUNNING,
          startedAt: new Date(),
          attempts: 1,
        },
        update: {
          status: JOB_STATUS.RUNNING,
          bullmqJobId,
          startedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    } else {
      await this.prisma.structuralAnalysisJob.update({
        where: { id },
        data: {
          status: JOB_STATUS.RUNNING,
          bullmqJobId,
          startedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    }
  }

  async markSucceeded(id: string, manifestId: string): Promise<void> {
    await this.prisma.structuralAnalysisJob.update({
      where: { id },
      data: {
        status: JOB_STATUS.SUCCEEDED,
        manifestId,
        finishedAt: new Date(),
      },
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.prisma.structuralAnalysisJob.update({
      where: { id },
      data: {
        status: JOB_STATUS.FAILED,
        finishedAt: new Date(),
        errorMessage,
      },
    });
  }

  async findActiveForSource(
    regionId: string,
    sourceUrl: string,
    dataType: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.structuralAnalysisJob.findFirst({
      where: {
        regionId,
        sourceUrl,
        dataType,
        status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] },
      },
      select: { id: true },
    });
  }

  async findRecent(limit: number): Promise<
    {
      id: string;
      status: string;
      regionId: string;
      sourceUrl: string;
      dataType: string;
      requestedBy: string;
      manifestId: string | null;
      enqueuedAt: Date;
      finishedAt: Date | null;
    }[]
  > {
    return this.prisma.structuralAnalysisJob.findMany({
      orderBy: { enqueuedAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        status: true,
        regionId: true,
        sourceUrl: true,
        dataType: true,
        requestedBy: true,
        manifestId: true,
        enqueuedAt: true,
        finishedAt: true,
      },
    });
  }
}
