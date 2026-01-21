import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { RelationalDBType } from "@qckstrt/common";

// Mock PrismaClient methods - define mocks before import
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockQueryRaw = jest.fn();
const mockExecuteRawUnsafe = jest.fn();

jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(function (this: object) {
      Object.assign(this, {
        $connect: mockConnect,
        $disconnect: mockDisconnect,
        $queryRaw: mockQueryRaw,
        $executeRawUnsafe: mockExecuteRawUnsafe,
      });
      return this;
    }),
  };
});

// Mock @qckstrt/common environment functions
jest.mock("@qckstrt/common", () => ({
  ...jest.requireActual("@qckstrt/common"),
  isDevelopment: jest.fn().mockReturnValue(false),
  isTest: jest.fn().mockReturnValue(true),
}));

// Import DbService after mocks are set up
import { DbService } from "../src/db.service";

describe("DbService", () => {
  let service: DbService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    module = await Test.createTestingModule({
      providers: [DbService],
    }).compile();

    service = module.get<DbService>(DbService);
  });

  afterEach(async () => {
    await module?.close();
  });

  describe("constructor", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });
  });

  describe("IRelationalDBProvider implementation", () => {
    it("should return correct name", () => {
      expect(service.getName()).toBe("Prisma PostgreSQL");
    });

    it("should return correct type", () => {
      expect(service.getType()).toBe(RelationalDBType.PostgreSQL);
    });
  });

  describe("connect", () => {
    it("should call $connect", async () => {
      mockConnect.mockClear();
      await service.connect();
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("should call $disconnect", async () => {
      await service.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("isAvailable", () => {
    it("should return true when database is available", async () => {
      mockQueryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);
      const result = await service.isAvailable();
      expect(result).toBe(true);
    });

    it("should return false when database query fails", async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error("Connection failed"));
      const result = await service.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("NestJS lifecycle hooks", () => {
    it("should connect on module init", async () => {
      mockConnect.mockClear();
      await service.onModuleInit();
      expect(mockConnect).toHaveBeenCalled();
    });

    it("should disconnect on module destroy", async () => {
      await service.onModuleDestroy();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("cleanDatabase", () => {
    it("should truncate all tables in test environment", async () => {
      const { isTest } = require("@qckstrt/common");
      (isTest as jest.Mock).mockReturnValue(true);

      mockQueryRaw.mockResolvedValueOnce([
        { tablename: "users" },
        { tablename: "documents" },
        { tablename: "_prisma_migrations" },
      ]);
      mockExecuteRawUnsafe.mockResolvedValue(undefined);

      await service.cleanDatabase();

      // Should truncate users and documents but not _prisma_migrations
      expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(2);
      expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
        'TRUNCATE TABLE "public"."users" CASCADE;',
      );
      expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
        'TRUNCATE TABLE "public"."documents" CASCADE;',
      );
    });

    it("should throw error if not in test environment", async () => {
      const { isTest } = require("@qckstrt/common");
      (isTest as jest.Mock).mockReturnValue(false);

      await expect(service.cleanDatabase()).rejects.toThrow(
        "cleanDatabase can only be used in test environment",
      );
    });

    it("should handle truncate errors gracefully", async () => {
      const { isTest } = require("@qckstrt/common");
      (isTest as jest.Mock).mockReturnValue(true);

      mockQueryRaw.mockResolvedValueOnce([{ tablename: "users" }]);
      mockExecuteRawUnsafe.mockRejectedValueOnce(new Error("Cannot truncate"));

      // Should not throw, just log warning
      await expect(service.cleanDatabase()).resolves.not.toThrow();
    });
  });
});
