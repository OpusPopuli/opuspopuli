import { AnalysisRequestSource, TriggerSource } from "./queue.constants";

export interface RegionSyncJobData {
  pipelineJobId: string;
  triggerSource: TriggerSource;
  regionId?: string;
  dataTypes?: string[];
  depth?: string;
  maxReps?: number;
  maxBills?: number;
}

export interface RegionSyncJobResult {
  regionId: string;
  dataType: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errors: string[];
  syncedAt: string;
}

export interface StructuralAnalysisJobData {
  structuralAnalysisJobId: string;
  regionId: string;
  sourceUrl: string;
  dataType: string;
  contentGoal?: string;
  category?: string;
  hints?: string[];
  requestedBy: AnalysisRequestSource;
}

export interface StructuralAnalysisJobResult {
  manifestId: string;
  manifestVersion: number;
  analysisTimeMs: number;
}

export interface QueueModuleOptions {
  url: string;
  prefix?: string;
}

export interface QueueModuleAsyncOptions {
  inject?: unknown[];
  useFactory: (
    ...args: unknown[]
  ) => QueueModuleOptions | Promise<QueueModuleOptions>;
  imports?: unknown[];
}

export interface EnqueueOptions {
  jobId?: string;
  delay?: number;
  priority?: number;
}

export interface QueueJobInfo {
  id: string;
  state: string;
  progress: number;
  failedReason?: string;
}

export interface SchedulerInfo {
  id: string;
  pattern: string;
  next: number | null;
}
