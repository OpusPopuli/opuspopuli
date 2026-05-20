import { TriggerSource } from "./queue.constants";

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
