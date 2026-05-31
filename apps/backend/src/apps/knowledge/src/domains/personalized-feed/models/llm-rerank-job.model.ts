import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum LlmRerankJobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export enum LlmRerankTriggerSource {
  MANUAL = 'MANUAL',
  CRON = 'CRON',
  STARTUP = 'STARTUP',
}

registerEnumType(LlmRerankJobStatus, {
  name: 'LlmRerankJobStatus',
  description: 'Current state of an async LLM rerank job (opuspopuli#745)',
});

registerEnumType(LlmRerankTriggerSource, {
  name: 'LlmRerankTriggerSource',
  description: 'What triggered the LLM rerank job',
});

/**
 * Per-user summary the worker writes to `llm_rerank_jobs.result` on
 * success. Mirrors `LlmRerankJobResult` from queue-provider — exposed
 * via GraphQL so the polling resolver can return it inline without a
 * client-side JSON parse.
 */
@ObjectType('LlmRerankJobResult')
export class LlmRerankJobResultModel {
  @Field(() => Int)
  candidatesConsidered!: number;

  @Field(() => Int)
  cacheWritesWithExplanation!: number;

  @Field(() => Int)
  cacheWritesWithoutExplanation!: number;

  @Field(() => Int)
  llmFailures!: number;

  @Field(() => Int)
  validatorRejections!: number;

  @Field()
  budgetExhausted!: boolean;

  @Field(() => Int)
  totalTokens!: number;
}

/**
 * Polling shape for `llm_rerank_jobs` rows. Used by the `myLlmRerankJob`
 * + `myRecentLlmRerankJobs` queries (opuspopuli#745) — mirrors the
 * `RegionSyncJobModel` shape so the frontend (or Postman) can poll the
 * lifecycle the same way.
 */
@ObjectType('LlmRerankJob')
export class LlmRerankJobModel {
  @Field(() => ID)
  jobId!: string;

  @Field(() => LlmRerankJobStatus)
  status!: LlmRerankJobStatus;

  @Field(() => LlmRerankTriggerSource)
  triggerSource!: LlmRerankTriggerSource;

  @Field({ nullable: true })
  candidateLimit?: number;

  @Field(() => Int)
  attempts!: number;

  @Field()
  enqueuedAt!: Date;

  @Field({ nullable: true })
  startedAt?: Date;

  @Field({ nullable: true })
  finishedAt?: Date;

  @Field({ nullable: true })
  errorMessage?: string;

  @Field(() => LlmRerankJobResultModel, { nullable: true })
  result?: LlmRerankJobResultModel;

  @Field({ nullable: true })
  elapsedMs?: number;
}
