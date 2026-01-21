/**
 * Test utilities for @qckstrt/relationaldb-provider
 *
 * Import from "@qckstrt/relationaldb-provider/testing" in test files.
 * Do NOT import from the main entry point as it will load jest-mock-extended
 * at runtime which fails outside of Jest test environment.
 *
 * @example
 * ```typescript
 * import {
 *   createMockDbService,
 *   MockDbClient,
 * } from '@qckstrt/relationaldb-provider/testing';
 *
 * describe('MyService', () => {
 *   let db: MockDbClient;
 *
 *   beforeEach(() => {
 *     db = createMockDbService();
 *   });
 * });
 * ```
 */

export {
  createMockDbClient,
  createMockDbService,
  resetMockDbClient,
  resetMockDbService,
  type MockDbClient,
} from "./test/db-mock.js";
