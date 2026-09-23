import {
  ObjectType,
  Field,
  ID,
  Float,
  registerEnumType,
} from '@nestjs/graphql';
import { SyncResultModel } from './region-info.model';

export enum SyncJobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  /**
   * Stopped on purpose by an operator, distinct from FAILED — which means the
   * run tried and could not. A dashboard that conflates the two cannot tell
   * "we stopped this" from "this broke".
   *
   * Must exist here, not only in `JOB_STATUS`: `toModel` casts the row's
   * status with `as SyncJobStatus`, so a value missing from this enum
   * typechecks fine and then fails GraphQL serialization at read time — on a
   * non-nullable field, which fails the whole query. That would break exactly
   * the `regionSyncJob` read an operator uses to confirm a cancel took effect.
   */
  CANCELLED = 'CANCELLED',
}

export enum SyncTriggerSource {
  MANUAL = 'MANUAL',
  CRON = 'CRON',
  STARTUP = 'STARTUP',
  MANIFEST_READY = 'MANIFEST_READY',
}

registerEnumType(SyncJobStatus, {
  name: 'SyncJobStatus',
  description: 'Current state of an async region sync job',
});

registerEnumType(SyncTriggerSource, {
  name: 'SyncTriggerSource',
  description: 'What triggered the sync job',
});

@ObjectType('ScheduledSyncJob')
export class ScheduledSyncJobModel {
  @Field(() => ID)
  id!: string;

  @Field()
  pattern!: string;

  @Field(() => Float, { nullable: true })
  next!: number | null;
}

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
