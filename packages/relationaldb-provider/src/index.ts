/**
 * Relational Database Provider Package
 *
 * Strategy Pattern + Dependency Injection for relational database connections.
 * Provides an abstracted database service for PostgreSQL (via Supabase).
 *
 * @example
 * ```typescript
 * import { RelationalDbModule, DbService } from '@qckstrt/relationaldb-provider';
 *
 * // In your module
 * @Module({
 *   imports: [RelationalDbModule],
 * })
 * export class AppModule {}
 *
 * // In your service
 * @Injectable()
 * export class MyService {
 *   constructor(private db: DbService) {}
 *
 *   async findUser(id: string) {
 *     return this.db.user.findUnique({ where: { id } });
 *   }
 * }
 * ```
 */

// Re-export types from common
export {
  IRelationalDBProvider,
  RelationalDBType,
  RelationalDBError,
  // Environment helpers
  getEnvironment,
  isDevelopment,
  isProduction,
  isTest,
  type Environment,
} from "@qckstrt/common";

// Database Service and Module
export { DbService } from "./db.service.js";
export { RelationalDbModule } from "./db.module.js";

// Re-export Prisma types for convenience
// This allows consumers to import Prisma types from this package
export { Prisma, PrismaClient } from "@prisma/client";

// Re-export all generated model types
export type {
  User,
  UserProfile,
  UserLogin,
  PasskeyCredential,
  WebAuthnChallenge,
  UserSession,
  UserConsent,
  UserAddress,
  EmailCorrespondence,
  NotificationPreference,
  AuditLog,
  Document,
  Representative,
  Proposition,
  Meeting,
} from "@prisma/client";

// Re-export database enums
// Note: AuthStrategy is not exported because the User.authStrategy field is a String, not an enum
export {
  PoliticalAffiliation,
  VotingFrequency,
  EducationLevel,
  IncomeRange,
  HomeownerStatus,
  ConsentType,
  ConsentStatus,
  AddressType,
  EmailType,
  EmailStatus,
  NotificationFrequency,
  DocumentStatus,
} from "@prisma/client";

// Test utilities are available from "@qckstrt/relationaldb-provider/testing"
// They are NOT exported from the main entry point to avoid loading
// jest-mock-extended in production environments.
