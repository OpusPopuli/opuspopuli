import { PrismaClient } from "@prisma/client";
import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";

/**
 * Type for deeply mocked database client
 */
export type MockDbClient = DeepMockProxy<PrismaClient>;

/**
 * Creates a deeply mocked database client for testing
 */
export const createMockDbClient = (): MockDbClient => {
  return mockDeep<PrismaClient>();
};

/**
 * Resets all mocks on a MockDbClient
 */
export const resetMockDbClient = (mock: MockDbClient): void => {
  mockReset(mock);
};

/**
 * Creates a deeply mocked DbService for testing
 * (DbService extends the underlying client, so they share the same mock type)
 */
export const createMockDbService = (): MockDbClient => {
  return createMockDbClient();
};

/**
 * Resets all mocks on a MockDbService
 */
export const resetMockDbService = (mock: MockDbClient): void => {
  resetMockDbClient(mock);
};
