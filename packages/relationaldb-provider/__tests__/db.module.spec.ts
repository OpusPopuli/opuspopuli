import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { RelationalDbModule } from "../src/db.module";
import { DbService } from "../src/db.service";

// Mock @qckstrt/common environment functions
jest.mock("@qckstrt/common", () => ({
  ...jest.requireActual("@qckstrt/common"),
  isDevelopment: jest.fn().mockReturnValue(false),
  isTest: jest.fn().mockReturnValue(true),
}));

// Mock PrismaClient methods
jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(function (this: object) {
      Object.assign(this, {
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
      });
      return this;
    }),
  };
});

describe("RelationalDbModule", () => {
  let module: TestingModule;
  let dbService: DbService;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      imports: [RelationalDbModule],
    }).compile();

    dbService = module.get<DbService>(DbService);
  });

  afterEach(async () => {
    await module?.close();
  });

  it("should be defined", () => {
    expect(module).toBeDefined();
  });

  it("should provide DbService", () => {
    expect(dbService).toBeDefined();
    expect(dbService).toBeInstanceOf(DbService);
  });

  it("should export DbService globally", async () => {
    // Create a child module that imports RelationalDbModule
    const childModule = await Test.createTestingModule({
      imports: [RelationalDbModule],
    }).compile();

    const childDbService = childModule.get<DbService>(DbService);
    expect(childDbService).toBeDefined();

    await childModule.close();
  });
});
