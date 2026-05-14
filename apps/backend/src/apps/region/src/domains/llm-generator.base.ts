import { Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { type ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Shared constructor parameters for region AI-generator services.
 *
 * All generator services (BioGeneratorService, CommitteeSummaryGeneratorService,
 * EntityActivitySummaryGeneratorService, LegislativeCommitteeDescriptionGeneratorService,
 * PropositionAnalysisService) inject the same four optional dependencies.
 * Extracting them here removes the constructor-signature duplication that
 * jscpd flags as structural clones.
 *
 * NestJS note: the `@Optional()` and `@Inject()` decorators on a base-class
 * constructor are inherited by subclasses through `reflect-metadata`, so the
 * DI container sees them when it instantiates the concrete subclass.
 */
export abstract class LlmGeneratorBase {
  constructor(
    @Optional() protected readonly config?: ConfigService,
    @Optional() protected readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    protected readonly llm?: ILLMProvider,
    @Optional() protected readonly db?: DbService,
  ) {}
}
