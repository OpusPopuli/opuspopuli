/**
 * Prompt Client Module
 *
 * NestJS module for providing PromptClientService.
 * Requires RelationalDbModule to be imported in the consuming app.
 */

import { DynamicModule, Module, Provider } from "@nestjs/common";
import { RelationalDbModule } from "@opuspopuli/relationaldb-provider";
import { PromptClientService } from "./prompt-client.service.js";
import { PROMPT_CLIENT_CONFIG } from "./types.js";
import type { PromptClientConfig } from "./types.js";

/**
 * Options for PromptClientModule.forRoot()
 */
export interface PromptClientModuleOptions {
  config?: PromptClientConfig;
}

@Module({
  imports: [RelationalDbModule],
  providers: [PromptClientService],
  exports: [PromptClientService],
})
export class PromptClientModule {
  /**
   * Configure with static options.
   */
  static forRoot(options: PromptClientModuleOptions = {}): DynamicModule {
    return {
      module: PromptClientModule,
      imports: [RelationalDbModule],
      providers: [
        {
          provide: PROMPT_CLIENT_CONFIG,
          useValue: options.config ?? {},
        },
        PromptClientService,
      ],
      exports: [PromptClientService],
    };
  }

  /**
   * Configure with async options (e.g., from ConfigService).
   */
  static forRootAsync(options: {
    imports?: any[];
    inject?: any[];
    useFactory: (
      ...args: any[]
    ) => PromptClientModuleOptions | Promise<PromptClientModuleOptions>;
  }): DynamicModule {
    const configProvider: Provider = {
      provide: PROMPT_CLIENT_CONFIG,
      useFactory: async (...args: any[]) => {
        const moduleOptions = await options.useFactory(...args);
        return moduleOptions.config ?? {};
      },
      inject: options.inject || [],
    };

    return {
      module: PromptClientModule,
      imports: [...(options.imports || []), RelationalDbModule],
      providers: [configProvider, PromptClientService],
      exports: [PromptClientService],
    };
  }
}
