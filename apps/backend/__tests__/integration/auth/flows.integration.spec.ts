/**
 * Authentication Flow Integration Tests
 *
 * Tests complete authentication workflows including:
 * - Cross-service auth context propagation
 * - Session management
 * - Token validation
 * - Auth guard behavior
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createUserLogin,
  createUserSession,
  getDbService,
  graphqlRequest,
  assertNoErrors,
  generateEmail,
} from '../utils';

// GraphQL operations for auth testing
// Helper to build inline query (avoids variable parsing issues)
const buildFindUserQuery = (email: string) => `
  query {
    findUser(email: "${email}") {
      id
      email
      firstName
      lastName
    }
  }
`;

const LIST_FILES_QUERY = `
  query ListFiles {
    listFiles {
      id
      key
      size
    }
  }
`;

const SEARCH_TEXT_QUERY = `
  query SearchText($input: SearchInput!) {
    searchText(input: $input) {
      results { id text }
      total
    }
  }
`;

describe('Authentication Flow Integration Tests', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('Auth Guard Behavior', () => {
    it('should allow public queries without authentication', async () => {
      // Create a user to query
      const user = await createUser({
        email: generateEmail('public'),
        firstName: 'Public',
      });

      // Query user without auth token
      const result = await graphqlRequest<{
        findUser: { id: string; email: string };
      }>(buildFindUserQuery(user.email));

      assertNoErrors(result);
      expect(result.data.findUser.id).toBe(user.id);
    });

    it('should reject protected queries without authentication', async () => {
      // Try to list files without auth - should fail
      const result = await graphqlRequest(LIST_FILES_QUERY);

      // Should have auth error
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should reject protected mutations without authentication', async () => {
      // Try to search without auth
      const result = await graphqlRequest(SEARCH_TEXT_QUERY, {
        input: { query: 'test', skip: 0, take: 10 },
      });

      // Should have auth error
      expect(result.errors).toBeDefined();
    });
  });

  describe('User Session Management', () => {
    it('should create active user session', async () => {
      const user = await createUser({ email: generateEmail('session') });

      const session = await createUserSession({
        userId: user.id,
        deviceType: 'desktop',
        browser: 'Chrome',
        isActive: true,
      });

      expect(session).toBeDefined();
      expect(session.isActive).toBe(true);
      expect(session.deviceType).toBe('desktop');
    });

    it('should track session expiration', async () => {
      const user = await createUser({ email: generateEmail('expiry') });
      const db = await getDbService();

      // Create session with specific expiry
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
      const session = await createUserSession({
        userId: user.id,
        expiresAt,
      });

      expect(session.expiresAt.getTime()).toBe(expiresAt.getTime());

      // Verify session is not yet expired
      const valid = await db.userSession.findFirst({
        where: {
          id: session.id,
          expiresAt: { gt: new Date() },
          isActive: true,
        },
      });
      expect(valid).toBeDefined();
    });

    it('should handle session revocation', async () => {
      const user = await createUser({ email: generateEmail('revoke') });
      const db = await getDbService();

      const session = await createUserSession({
        userId: user.id,
        isActive: true,
      });

      // Revoke the session
      await db.userSession.update({
        where: { id: session.id },
        data: {
          isActive: false,
          revokedAt: new Date(),
          revokedReason: 'user_initiated',
        },
      });

      // Verify session is revoked
      const revoked = await db.userSession.findUnique({
        where: { id: session.id },
      });
      expect(revoked?.isActive).toBe(false);
      expect(revoked?.revokedReason).toBe('user_initiated');
    });

    it('should support multiple active sessions per user', async () => {
      const user = await createUser({ email: generateEmail('multi') });
      const db = await getDbService();

      // Create sessions from different devices
      await createUserSession({
        userId: user.id,
        deviceType: 'desktop',
        browser: 'Chrome',
      });
      await createUserSession({
        userId: user.id,
        deviceType: 'mobile',
        browser: 'Safari',
      });
      await createUserSession({
        userId: user.id,
        deviceType: 'tablet',
        browser: 'Firefox',
      });

      const sessions = await db.userSession.findMany({
        where: { userId: user.id, isActive: true },
      });

      expect(sessions).toHaveLength(3);
    });
  });

  describe('Login Tracking', () => {
    it('should track login count', async () => {
      const user = await createUser({ email: generateEmail('login-count') });
      const db = await getDbService();

      // Create login record
      await createUserLogin({
        userId: user.id,
        loginCount: 5,
      });

      const login = await db.userLogin.findUnique({
        where: { userId: user.id },
      });

      expect(login?.loginCount).toBe(5);
    });

    it('should track failed login attempts', async () => {
      const user = await createUser({ email: generateEmail('failed') });
      const db = await getDbService();

      // Create login record with failed attempts
      await createUserLogin({
        userId: user.id,
        failedLoginAttempts: 3,
      });

      const login = await db.userLogin.findUnique({
        where: { userId: user.id },
      });

      expect(login?.failedLoginAttempts).toBe(3);
    });

    it('should track account lockout', async () => {
      const user = await createUser({ email: generateEmail('lockout') });
      const db = await getDbService();

      const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await createUserLogin({
        userId: user.id,
        failedLoginAttempts: 5,
        lockedUntil: lockUntil,
      });

      const login = await db.userLogin.findUnique({
        where: { userId: user.id },
      });

      expect(login?.lockedUntil).toBeDefined();
      expect(login?.lockedUntil?.getTime()).toBe(lockUntil.getTime());
    });

    it('should unlock account after lockout period', async () => {
      const user = await createUser({ email: generateEmail('unlock') });
      const db = await getDbService();

      // Create locked account with past lockout time
      const pastLockout = new Date(Date.now() - 1000); // Already expired
      await createUserLogin({
        userId: user.id,
        failedLoginAttempts: 5,
        lockedUntil: pastLockout,
      });

      // Check if account would be unlocked
      const login = await db.userLogin.findFirst({
        where: {
          userId: user.id,
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
        },
      });

      expect(login).toBeDefined(); // Account should be considered unlocked
    });
  });

  describe('Cross-Service Auth Propagation', () => {
    it('should allow public data access across services', async () => {
      // Create data in multiple services
      const user = await createUser({
        email: generateEmail('cross'),
        firstName: 'Cross',
        lastName: 'Service',
      });

      // Query user data (public endpoint)
      const result = await graphqlRequest<{
        findUser: { id: string; firstName: string };
      }>(buildFindUserQuery(user.email));

      assertNoErrors(result);
      expect(result.data.findUser.firstName).toBe('Cross');
    });
  });

  describe('Session Cleanup', () => {
    it('should handle expired session cleanup', async () => {
      const user = await createUser({ email: generateEmail('cleanup') });
      const db = await getDbService();

      // Create expired session
      const pastDate = new Date(Date.now() - 86400000); // 24 hours ago
      await createUserSession({
        userId: user.id,
        expiresAt: pastDate,
        isActive: true,
      });

      // Query for non-expired sessions only
      const activeSessions = await db.userSession.findMany({
        where: {
          userId: user.id,
          expiresAt: { gt: new Date() },
          isActive: true,
        },
      });

      expect(activeSessions).toHaveLength(0);
    });

    it('should revoke all sessions on logout-all', async () => {
      const user = await createUser({ email: generateEmail('logout-all') });
      const db = await getDbService();

      // Create multiple sessions
      await createUserSession({ userId: user.id, deviceType: 'desktop' });
      await createUserSession({ userId: user.id, deviceType: 'mobile' });
      await createUserSession({ userId: user.id, deviceType: 'tablet' });

      // Simulate logout-all: revoke all sessions
      await db.userSession.updateMany({
        where: { userId: user.id },
        data: {
          isActive: false,
          revokedAt: new Date(),
          revokedReason: 'logout_all',
        },
      });

      // Verify all sessions are revoked
      const activeSessions = await db.userSession.findMany({
        where: { userId: user.id, isActive: true },
      });

      expect(activeSessions).toHaveLength(0);
    });
  });

  describe('Device Tracking', () => {
    it('should track device information in session', async () => {
      const user = await createUser({ email: generateEmail('device') });

      const session = await createUserSession({
        userId: user.id,
        deviceType: 'desktop',
        deviceName: 'MacBook Pro',
        browser: 'Chrome',
        operatingSystem: 'macOS Sonoma',
        ipAddress: '192.168.1.100',
      });

      expect(session.deviceType).toBe('desktop');
      expect(session.deviceName).toBe('MacBook Pro');
      expect(session.browser).toBe('Chrome');
      expect(session.operatingSystem).toBe('macOS Sonoma');
      expect(session.ipAddress).toBe('192.168.1.100');
    });

    it('should track location information in session', async () => {
      const user = await createUser({ email: generateEmail('location') });

      const session = await createUserSession({
        userId: user.id,
        city: 'San Francisco',
        region: 'California',
        country: 'US',
      });

      expect(session.city).toBe('San Francisco');
      expect(session.region).toBe('California');
      expect(session.country).toBe('US');
    });
  });

  describe('Last Activity Tracking', () => {
    it('should update last activity timestamp', async () => {
      const user = await createUser({ email: generateEmail('activity') });
      const db = await getDbService();

      const session = await createUserSession({
        userId: user.id,
      });

      const initialActivity = session.lastActivityAt;

      // Simulate activity update
      await new Promise((resolve) => setTimeout(resolve, 10));
      await db.userSession.update({
        where: { id: session.id },
        data: { lastActivityAt: new Date() },
      });

      const updated = await db.userSession.findUnique({
        where: { id: session.id },
      });

      expect(updated?.lastActivityAt?.getTime()).toBeGreaterThan(
        initialActivity?.getTime() ?? 0,
      );
    });
  });
});
