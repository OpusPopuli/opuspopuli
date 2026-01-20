import { PrismaClient } from '@prisma/client';
import { mockDeep, DeepMockProxy, mockReset } from 'jest-mock-extended';

/**
 * Type for deeply mocked PrismaClient
 */
export type MockPrismaClient = DeepMockProxy<PrismaClient>;

/**
 * Creates a deeply mocked PrismaClient for testing
 */
export const createMockPrismaClient = (): MockPrismaClient => {
  return mockDeep<PrismaClient>();
};

/**
 * Resets all mocks on a MockPrismaClient
 */
export const resetMockPrismaClient = (mock: MockPrismaClient): void => {
  mockReset(mock);
};

/**
 * Type alias for PrismaService mock - exported for test compatibility
 * (PrismaService extends PrismaClient, so they share the same mock type)
 */
export type MockPrismaService = MockPrismaClient;

/**
 * Creates a deeply mocked PrismaService for testing
 */
export const createMockPrismaService = (): MockPrismaService => {
  return createMockPrismaClient();
};

/**
 * Resets all mocks on a MockPrismaService
 */
export const resetMockPrismaService = (mock: MockPrismaService): void => {
  resetMockPrismaClient(mock);
};
