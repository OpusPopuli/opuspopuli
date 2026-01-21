import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service.js";

/**
 * RelationalDbModule provides the DbService globally across the application.
 * Being marked as @Global(), it only needs to be imported once in the root module.
 *
 * Usage:
 * ```typescript
 * import { RelationalDbModule } from '@qckstrt/relationaldb-provider';
 *
 * @Module({
 *   imports: [RelationalDbModule],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class RelationalDbModule {}
