import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { SyncResultModel } from './region-info.model';

export enum SyncJobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export enum SyncTriggerSource {
  MANUAL = 'MANUAL',
  CRON = 'CRON',
  STARTUP = 'STARTUP',
}

registerEnumType(SyncJobStatus, {
  name: 'SyncJobStatus',
  description: 'Current state of an async region sync job',
});

registerEnumType(SyncTriggerSource, {
  name: 'SyncTriggerSource',
  description: 'What triggered the sync job',
});

@ObjectType('RegionSyncJob')
export class RegionSyncJobModel {
  @Field(() => ID)
  jobId!: string;

  @Field(() => SyncJobStatus)
  status!: SyncJobStatus;

  @Field(() => SyncTriggerSource)
  triggerSource!: SyncTriggerSource;

  @Field({ nullable: true })
  regionId?: string;

  @Field(() => [String])
  dataTypes!: string[];

  @Field()
  enqueuedAt!: Date;

  @Field({ nullable: true })
  startedAt?: Date;

  @Field({ nullable: true })
  finishedAt?: Date;

  @Field({ nullable: true })
  errorMessage?: string;

  @Field(() => [SyncResultModel], { nullable: true })
  results?: SyncResultModel[];

  @Field({ nullable: true })
  elapsedMs?: number;
}
