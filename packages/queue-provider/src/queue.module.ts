import { DynamicModule, Module, Provider } from "@nestjs/common";
import IORedis from "ioredis";
import { QUEUE_CONNECTION, QUEUE_MODULE_OPTIONS } from "./queue.constants";
import { QueueService } from "./queue.service";
import { QueueModuleOptions } from "./queue.types";

export interface QueueModuleAsyncOptions {
  inject?: unknown[];
  useFactory: (
    ...args: unknown[]
  ) => QueueModuleOptions | Promise<QueueModuleOptions>;
  imports?: unknown[];
}

@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions): DynamicModule {
    return QueueModule.buildModule([
      { provide: QUEUE_MODULE_OPTIONS, useValue: options },
      {
        provide: QUEUE_CONNECTION,
        useFactory: () =>
          new IORedis(options.url, { maxRetriesPerRequest: null }),
      },
    ]);
  }

  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: QUEUE_MODULE_OPTIONS,
      inject: (options.inject ?? []) as string[],
      useFactory: options.useFactory as (
        ...args: unknown[]
      ) => QueueModuleOptions,
    };

    const connectionProvider: Provider = {
      provide: QUEUE_CONNECTION,
      inject: [QUEUE_MODULE_OPTIONS],
      useFactory: (opts: QueueModuleOptions) =>
        new IORedis(opts.url, { maxRetriesPerRequest: null }),
    };

    return QueueModule.buildModule(
      [optionsProvider, connectionProvider],
      (options.imports ?? []) as DynamicModule[],
    );
  }

  private static buildModule(
    providers: Provider[],
    imports: DynamicModule[] = [],
  ): DynamicModule {
    return {
      module: QueueModule,
      imports,
      providers: [...providers, QueueService],
      exports: [QueueService, QUEUE_CONNECTION, QUEUE_MODULE_OPTIONS],
    };
  }
}
