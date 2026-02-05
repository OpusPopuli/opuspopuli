/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConfigService } from "@nestjs/config";
import { SupabaseVaultProvider } from "../src/providers/supabase-vault.provider";
import { SecretsError } from "@opuspopuli/common";

// Mock the Supabase client
const mockRpc = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn().mockImplementation(() => ({
    rpc: mockRpc,
  })),
}));

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
      mockRpc.mockResolvedValue({
        data: [{ decrypted_secret: "my-secret-value" }],
        error: null,
      });

      const result = await provider.getSecret("my-secret-id");

      expect(result).toBe("my-secret-value");
      expect(mockRpc).toHaveBeenCalledWith("vault_read_secret", {
        secret_name: "my-secret-id",
      });
    });

    it("should return undefined when secret not found (empty array)", async () => {
      mockRpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await provider.getSecret("nonexistent-secret");

      expect(result).toBeUndefined();
    });

    it("should return undefined when secret not found (null data)", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await provider.getSecret("nonexistent-secret");

      expect(result).toBeUndefined();
    });

    it("should return undefined when RPC function does not exist", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "function does not exist", code: "PGRST116" },
      });

      const result = await provider.getSecret("my-secret-id");

      expect(result).toBeUndefined();
    });

    it("should throw SecretsError on other errors", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "Database connection failed" },
      });

      await expect(provider.getSecret("my-secret-id")).rejects.toThrow(
        SecretsError,
      );
    });
  });

  describe("getSecrets", () => {
    it("should retrieve multiple secrets successfully", async () => {
      mockRpc
        .mockResolvedValueOnce({
          data: [{ decrypted_secret: "value1" }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ decrypted_secret: "value2" }],
          error: null,
        });

      const result = await provider.getSecrets(["secret1", "secret2"]);

      expect(result).toEqual({
        secret1: "value1",
        secret2: "value2",
      });
    });

    it("should handle mixed results with some failures", async () => {
      mockRpc
        .mockResolvedValueOnce({
          data: [{ decrypted_secret: "value1" }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: { message: "Access denied" },
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
      mockRpc.mockResolvedValue({
        data: [
          {
            decrypted_secret: JSON.stringify({
              username: "admin",
              password: "secret",
            }),
          },
        ],
        error: null,
      });

      const result = await provider.getSecretJson<{
        username: string;
        password: string;
      }>("db-credentials");

      expect(result).toEqual({ username: "admin", password: "secret" });
    });

    it("should return undefined when secret not found", async () => {
      mockRpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await provider.getSecretJson("nonexistent-secret");

      expect(result).toBeUndefined();
    });

    it("should throw SecretsError when JSON is invalid", async () => {
      mockRpc.mockResolvedValue({
        data: [{ decrypted_secret: "not-valid-json" }],
        error: null,
      });

      await expect(
        provider.getSecretJson("invalid-json-secret"),
      ).rejects.toThrow(SecretsError);
    });
  });
});
