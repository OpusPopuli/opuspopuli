/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConfigService } from "@nestjs/config";
import { SupabaseVaultProvider } from "../src/providers/supabase-vault.provider";
import { SecretsError } from "@opuspopuli/common";

// Mock the Supabase client with chainable query builder
let mockQueryResult: { data: any; error: any } = { data: [], error: null };

const mockLimit = jest.fn().mockImplementation(() => mockQueryResult);
const mockEq = jest.fn().mockImplementation(() => ({ limit: mockLimit }));
const mockSelect = jest.fn().mockImplementation(() => ({ eq: mockEq }));
const mockFrom = jest.fn().mockImplementation(() => ({ select: mockSelect }));
const mockSchema = jest.fn().mockImplementation(() => ({ from: mockFrom }));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn().mockImplementation(() => ({
    schema: mockSchema,
  })),
}));

function setMockResult(data: any, error: any = null) {
  mockQueryResult = { data, error };
}

describe("SupabaseVaultProvider", () => {
  let provider: SupabaseVaultProvider;
  let configService: ConfigService;

  const createConfigService = (
    overrides: Record<string, string | undefined> = {},
  ) => {
    const config: Record<string, string | undefined> = {
      "supabase.url": "http://localhost:8000",
      "supabase.anonKey": "test-anon-key",
      "supabase.serviceRoleKey": "test-service-key",
      ...overrides,
    };
    return {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the chainable mock to use the shared mockQueryResult
    mockLimit.mockImplementation(() => mockQueryResult);
    setMockResult([], null);
    configService = createConfigService();
    provider = new SupabaseVaultProvider(configService);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider).toBeDefined();
      expect(provider.getName()).toBe("SupabaseVaultProvider");
    });

    it("should throw SecretsError when config is missing", () => {
      const badConfig = createConfigService({
        "supabase.url": undefined,
        "supabase.anonKey": undefined,
        "supabase.serviceRoleKey": undefined,
      });

      expect(() => new SupabaseVaultProvider(badConfig)).toThrow(SecretsError);
    });
  });

  describe("getSecret", () => {
    it("should retrieve secret successfully", async () => {
      setMockResult([{ decrypted_secret: "my-secret-value" }]);

      const result = await provider.getSecret("my-secret-id");

      expect(result).toBe("my-secret-value");
      expect(mockSchema).toHaveBeenCalledWith("vault");
      expect(mockFrom).toHaveBeenCalledWith("decrypted_secrets");
      expect(mockSelect).toHaveBeenCalledWith("decrypted_secret");
      expect(mockEq).toHaveBeenCalledWith("name", "my-secret-id");
    });

    it("should return undefined when secret not found (empty array)", async () => {
      setMockResult([]);

      const result = await provider.getSecret("nonexistent-secret");

      expect(result).toBeUndefined();
    });

    it("should return undefined when secret not found (null data)", async () => {
      setMockResult(null);

      const result = await provider.getSecret("nonexistent-secret");

      expect(result).toBeUndefined();
    });

    it("should return undefined when vault view does not exist", async () => {
      setMockResult(null, {
        message: "relation does not exist",
        code: "PGRST116",
      });

      const result = await provider.getSecret("my-secret-id");

      expect(result).toBeUndefined();
    });

    it("should throw SecretsError on other errors", async () => {
      setMockResult(null, { message: "Database connection failed" });

      await expect(provider.getSecret("my-secret-id")).rejects.toThrow(
        SecretsError,
      );
    });
  });

  describe("getSecrets", () => {
    it("should retrieve multiple secrets successfully", async () => {
      const results = [
        [{ decrypted_secret: "value1" }],
        [{ decrypted_secret: "value2" }],
      ];
      let callCount = 0;
      mockLimit.mockImplementation(() => ({
        data: results[callCount++],
        error: null,
      }));

      const result = await provider.getSecrets(["secret1", "secret2"]);

      expect(result).toEqual({
        secret1: "value1",
        secret2: "value2",
      });
    });

    it("should handle mixed results with some failures", async () => {
      let callCount = 0;
      mockLimit.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { data: [{ decrypted_secret: "value1" }], error: null };
        }
        return { data: null, error: { message: "Access denied" } };
      });

      const result = await provider.getSecrets(["secret1", "secret2"]);

      expect(result.secret1).toBe("value1");
      expect(result.secret2).toBeUndefined();
    });

    it("should handle empty secret ids array", async () => {
      const result = await provider.getSecrets([]);

      expect(result).toEqual({});
    });
  });

  describe("getSecretJson", () => {
    it("should parse JSON secret successfully", async () => {
      setMockResult([
        {
          decrypted_secret: JSON.stringify({
            username: "admin",
            password: "secret",
          }),
        },
      ]);

      const result = await provider.getSecretJson<{
        username: string;
        password: string;
      }>("db-credentials");

      expect(result).toEqual({ username: "admin", password: "secret" });
    });

    it("should return undefined when secret not found", async () => {
      setMockResult([]);

      const result = await provider.getSecretJson("nonexistent-secret");

      expect(result).toBeUndefined();
    });

    it("should throw SecretsError when JSON is invalid", async () => {
      setMockResult([{ decrypted_secret: "not-valid-json" }]);

      await expect(
        provider.getSecretJson("invalid-json-secret"),
      ).rejects.toThrow(SecretsError);
    });
  });
});
