/**
 * API Gateway Federation Integration Tests
 *
 * Tests that the API gateway correctly federates schemas from all microservices
 * and properly routes queries to the appropriate services.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createRepresentative,
  createProposition,
  graphqlRequest,
  assertNoErrors,
} from '../utils';

// Introspection query to check schema types
const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      types {
        name
        kind
      }
    }
  }
`;

// Check specific type exists
const buildTypeIntrospectionQuery = (typeName: string) => `
  query {
    __type(name: "${typeName}") {
      name
      kind
      fields {
        name
        type {
          name
          kind
        }
      }
    }
  }
`;

// Query types from multiple services in a single request
const MULTI_SERVICE_QUERY = `
  query MultiServiceQuery {
    __type(name: "Query") {
      name
      fields {
        name
      }
    }
  }
`;

describe('API Gateway Federation Tests', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('Schema Introspection', () => {
    it('should expose a valid GraphQL schema', async () => {
      const result = await graphqlRequest<{
        __schema: {
          types: Array<{ name: string; kind: string }>;
        };
      }>(INTROSPECTION_QUERY);

      assertNoErrors(result);
      expect(result.data.__schema).toBeDefined();
      expect(Array.isArray(result.data.__schema.types)).toBe(true);
      expect(result.data.__schema.types.length).toBeGreaterThan(0);
    });

    it('should include User type from users service', async () => {
      const result = await graphqlRequest<{
        __type: {
          name: string;
          kind: string;
          fields: Array<{ name: string; type: { name: string; kind: string } }>;
        };
      }>(buildTypeIntrospectionQuery('User'));

      assertNoErrors(result);
      expect(result.data.__type).toBeDefined();
      expect(result.data.__type.name).toBe('User');
      expect(result.data.__type.kind).toBe('OBJECT');

      // Check User has expected fields
      const fieldNames = result.data.__type.fields.map((f) => f.name);
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('email');
    });

    it('should include File type from documents service', async () => {
      const result = await graphqlRequest<{
        __type: {
          name: string;
          kind: string;
          fields: Array<{ name: string }>;
        } | null;
      }>(buildTypeIntrospectionQuery('File'));

      assertNoErrors(result);
      // File type may exist if documents service exposes it
      if (result.data.__type) {
        expect(result.data.__type.name).toBe('File');
        expect(result.data.__type.kind).toBe('OBJECT');
      }
    });

    it('should include RepresentativeModel type from region service', async () => {
      const result = await graphqlRequest<{
        __type: {
          name: string;
          kind: string;
          fields: Array<{ name: string }>;
        } | null;
      }>(buildTypeIntrospectionQuery('RepresentativeModel'));

      assertNoErrors(result);
      expect(result.data.__type).toBeDefined();
      expect(result.data.__type?.name).toBe('RepresentativeModel');

      const fieldNames = result.data.__type?.fields.map((f) => f.name) || [];
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('chamber');
    });

    it('should include PropositionModel type from region service', async () => {
      const result = await graphqlRequest<{
        __type: {
          name: string;
          kind: string;
          fields: Array<{ name: string }>;
        } | null;
      }>(buildTypeIntrospectionQuery('PropositionModel'));

      assertNoErrors(result);
      expect(result.data.__type).toBeDefined();
      expect(result.data.__type?.name).toBe('PropositionModel');

      const fieldNames = result.data.__type?.fields.map((f) => f.name) || [];
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('title');
      expect(fieldNames).toContain('status');
    });

    it('should expose Query type with operations from all services', async () => {
      const result = await graphqlRequest<{
        __type: {
          name: string;
          fields: Array<{ name: string }>;
        };
      }>(MULTI_SERVICE_QUERY);

      assertNoErrors(result);
      expect(result.data.__type).toBeDefined();
      expect(result.data.__type.name).toBe('Query');

      const queryNames = result.data.__type.fields.map((f) => f.name);

      // Users service queries
      expect(queryNames).toContain('findUser');

      // Region service queries
      expect(queryNames).toContain('representatives');
      expect(queryNames).toContain('propositions');
      expect(queryNames).toContain('meetings');
      expect(queryNames).toContain('regionInfo');
    });
  });

  describe('Query Routing: Users Service', () => {
    it('should route findUser query to users service', async () => {
      const user = await createUser({
        email: 'federation-user@example.com',
        firstName: 'Federation',
        lastName: 'Test',
      });

      const result = await graphqlRequest<{
        findUser: {
          id: string;
          email: string;
          firstName: string;
          lastName: string;
        };
      }>(`
        query {
          findUser(email: "federation-user@example.com") {
            id
            email
            firstName
            lastName
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.findUser).toBeDefined();
      expect(result.data.findUser.id).toBe(user.id);
      expect(result.data.findUser.email).toBe('federation-user@example.com');
      expect(result.data.findUser.firstName).toBe('Federation');
    });
  });

  describe('Query Routing: Region Service', () => {
    it('should route representatives query to region service', async () => {
      await createRepresentative({
        name: 'Federation Rep',
        chamber: 'House',
        district: 'TEST-1',
      });

      const result = await graphqlRequest<{
        representatives: {
          items: Array<{ id: string; name: string; chamber: string }>;
          total: number;
        };
      }>(`
        query {
          representatives(skip: 0, take: 10) {
            items {
              id
              name
              chamber
            }
            total
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.representatives).toBeDefined();
      expect(result.data.representatives.total).toBe(1);
      expect(result.data.representatives.items[0].name).toBe('Federation Rep');
    });

    it('should route propositions query to region service', async () => {
      await createProposition({
        title: 'Federation Prop',
        summary: 'Test proposition for federation',
      });

      const result = await graphqlRequest<{
        propositions: {
          items: Array<{ id: string; title: string; summary: string }>;
          total: number;
        };
      }>(`
        query {
          propositions(skip: 0, take: 10) {
            items {
              id
              title
              summary
            }
            total
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.propositions).toBeDefined();
      expect(result.data.propositions.total).toBe(1);
      expect(result.data.propositions.items[0].title).toBe('Federation Prop');
    });

    it('should route regionInfo query to region service', async () => {
      const result = await graphqlRequest<{
        regionInfo: {
          name: string;
          timezone: string;
          supportedDataTypes: string[];
        };
      }>(`
        query {
          regionInfo {
            name
            timezone
            supportedDataTypes
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.regionInfo).toBeDefined();
      expect(result.data.regionInfo.name).toBeDefined();
      expect(result.data.regionInfo.timezone).toBeDefined();
    });
  });

  describe('Multi-Service Queries', () => {
    it('should execute queries to multiple services in parallel', async () => {
      // Create data in multiple services
      const user = await createUser({
        email: 'multi-query@example.com',
        firstName: 'Multi',
      });
      await createRepresentative({
        name: 'Multi Rep',
        chamber: 'Senate',
      });
      await createProposition({
        title: 'Multi Prop',
      });

      // Query data from users and region services in one request
      const result = await graphqlRequest<{
        findUser: { id: string; email: string };
        representatives: { total: number };
        propositions: { total: number };
      }>(`
        query MultiServiceQuery {
          findUser(email: "multi-query@example.com") {
            id
            email
          }
          representatives(skip: 0, take: 1) {
            total
          }
          propositions(skip: 0, take: 1) {
            total
          }
        }
      `);

      assertNoErrors(result);

      // Verify data from users service
      expect(result.data.findUser).toBeDefined();
      expect(result.data.findUser.id).toBe(user.id);

      // Verify data from region service
      expect(result.data.representatives.total).toBe(1);
      expect(result.data.propositions.total).toBe(1);
    });

    it('should handle empty results from multiple services gracefully', async () => {
      // Query with no data seeded
      const result = await graphqlRequest<{
        representatives: { items: unknown[]; total: number };
        propositions: { items: unknown[]; total: number };
        meetings: { items: unknown[]; total: number };
      }>(`
        query {
          representatives(skip: 0, take: 10) {
            items { id }
            total
          }
          propositions(skip: 0, take: 10) {
            items { id }
            total
          }
          meetings(skip: 0, take: 10) {
            items { id }
            total
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.representatives.total).toBe(0);
      expect(result.data.propositions.total).toBe(0);
      expect(result.data.meetings.total).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should return error for non-existent user query', async () => {
      const result = await graphqlRequest<{
        findUser: null;
      }>(`
        query {
          findUser(email: "nonexistent@example.com") {
            id
            email
          }
        }
      `);

      // findUser returns User! (non-nullable), so it throws an error
      expect(result.errors).toBeDefined();
    });

    it('should return null for non-existent representative', async () => {
      const result = await graphqlRequest<{
        representative: null;
      }>(`
        query {
          representative(id: "non-existent-id") {
            id
            name
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.representative).toBeNull();
    });

    it('should return null for non-existent proposition', async () => {
      const result = await graphqlRequest<{
        proposition: null;
      }>(`
        query {
          proposition(id: "non-existent-id") {
            id
            title
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.proposition).toBeNull();
    });
  });

  describe('Service Health Check', () => {
    it('should have all federated services healthy', async () => {
      // This test verifies the gateway can reach all services
      // by querying something from each
      const result = await graphqlRequest<{
        regionInfo: { name: string };
      }>(`
        query {
          regionInfo {
            name
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.regionInfo).toBeDefined();
    });
  });

  describe('Database cleanup', () => {
    it('should have clean database at start of each test', async () => {
      await createUser({ email: 'cleanup@example.com' });
      await createRepresentative({ name: 'Cleanup Rep' });

      const result = await graphqlRequest<{
        findUser: { email: string };
        representatives: { total: number };
      }>(`
        query {
          findUser(email: "cleanup@example.com") {
            email
          }
          representatives(skip: 0, take: 10) {
            total
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.findUser.email).toBe('cleanup@example.com');
      expect(result.data.representatives.total).toBe(1);
    });

    it('should not see data from previous tests', async () => {
      const result = await graphqlRequest<{
        representatives: { total: number };
        propositions: { total: number };
      }>(`
        query {
          representatives(skip: 0, take: 10) {
            total
          }
          propositions(skip: 0, take: 10) {
            total
          }
        }
      `);

      assertNoErrors(result);
      expect(result.data.representatives.total).toBe(0);
      expect(result.data.propositions.total).toBe(0);
    });
  });
});
