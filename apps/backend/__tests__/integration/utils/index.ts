/**
 * Integration Test Utilities
 *
 * This module exports all utilities needed for integration testing.
 * All GraphQL requests go through the API Gateway (localhost:3000).
 *
 * @example
 * ```typescript
 * import {
 *   cleanDatabase,
 *   disconnectDatabase,
 *   createUser,
 *   graphqlRequest,
 *   assertNoErrors,
 * } from '../utils';
 *
 * describe('My Integration Tests', () => {
 *   beforeEach(async () => {
 *     await cleanDatabase();
 *   });
 *
 *   afterAll(async () => {
 *     await disconnectDatabase();
 *   });
 *
 *   it('should query user via API Gateway', async () => {
 *     const user = await createUser({ email: 'test@example.com' });
 *     const result = await graphqlRequest(`
 *       query { findUser(email: "test@example.com") { id email } }
 *     `);
 *     assertNoErrors(result);
 *     expect(result.data.findUser.id).toBe(user.id);
 *   });
 * });
 * ```
 */

// Database cleanup utilities
export { cleanDatabase, disconnectDatabase, getDbService } from './db-cleanup';

// Fixture factories
export {
  // Helpers
  generateId,
  generateEmail,
  // User fixtures
  createUser,
  createUsers,
  type CreateUserOptions,
  // Profile fixtures
  createProfile,
  type CreateProfileOptions,
  // Address fixtures
  createAddress,
  type CreateAddressOptions,
  // Consent fixtures
  createConsent,
  type CreateConsentOptions,
  // Notification preference fixtures
  createNotificationPrefs,
  type CreateNotificationPrefsOptions,
  // Document fixtures
  createDocument,
  type CreateDocumentOptions,
  // Civic entity fixtures
  createRepresentative,
  type CreateRepresentativeOptions,
  createProposition,
  type CreatePropositionOptions,
  createMeeting,
  type CreateMeetingOptions,
  // Composite fixtures
  createUserWithProfile,
  type CreateUserWithProfileOptions,
} from './db-fixtures';

// Test context utilities
export {
  SERVICE_URLS,
  type TestContext,
  // GraphQL request functions (through API Gateway)
  graphqlRequest,
  authenticatedGraphqlRequest,
  // Direct service access (bypasses gateway - for debugging)
  directServiceRequest,
  // CSRF token management
  clearCsrfToken,
  // Test context helpers
  createTestContext,
  createTestContextDirect,
  findUserByEmail,
  findUserById,
  // Assertion helpers
  assertNoErrors,
  assertHasError,
} from './test-context';

// Re-export common test utilities
export {
  BASE_URL,
  SUPABASE_URL,
  INBUCKET_URL,
  getMagicLinkFromInbucket,
  clearInbucketMailbox,
  waitFor,
  authenticatedFetch,
  generateTestEmail,
} from '../test-utils';
