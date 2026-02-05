import {
  EnvProvider,
  getEnvSecret,
  getEnvSecretOrThrow,
} from "../src/providers/env.provider";
import { SecretsError } from "@opuspopuli/common";

describe("EnvProvider", () => {
  let provider: EnvProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh copy of environment for each test
    process.env = { ...originalEnv };
    provider = new EnvProvider();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("getName", () => {
    it("should return provider name", () => {
      expect(provider.getName()).toBe("EnvProvider");
    });
  });

  describe("getSecret", () => {
    it("should return secret from environment", async () => {
      process.env.TEST_SECRET = "secret-value";

      const result = await provider.getSecret("TEST_SECRET");

      expect(result).toBe("secret-value");
    });

    it("should return undefined for missing secret", async () => {
      const result = await provider.getSecret("MISSING_SECRET");

      expect(result).toBeUndefined();
    });

    it("should handle empty string value", async () => {
      process.env.EMPTY_SECRET = "";

      const result = await provider.getSecret("EMPTY_SECRET");

      expect(result).toBe("");
    });
  });

  describe("getSecrets", () => {
    it("should return multiple secrets", async () => {
      process.env.SECRET_ONE = "value-one";
      process.env.SECRET_TWO = "value-two";

      const result = await provider.getSecrets(["SECRET_ONE", "SECRET_TWO"]);

      expect(result).toEqual({
        SECRET_ONE: "value-one",
        SECRET_TWO: "value-two",
      });
    });

    it("should return undefined for missing secrets", async () => {
      process.env.EXISTING_SECRET = "exists";

      const result = await provider.getSecrets([
        "EXISTING_SECRET",
        "MISSING_SECRET",
      ]);

      expect(result).toEqual({
        EXISTING_SECRET: "exists",
        MISSING_SECRET: undefined,
      });
    });

    it("should handle empty array", async () => {
      const result = await provider.getSecrets([]);

      expect(result).toEqual({});
    });
  });

  describe("getSecretJson", () => {
    it("should parse JSON secrets", async () => {
      process.env.JSON_SECRET = '{"key":"value","number":42}';

      const result = await provider.getSecretJson<{
        key: string;
        number: number;
      }>("JSON_SECRET");

      expect(result).toEqual({ key: "value", number: 42 });
    });

    it("should return undefined for missing JSON secret", async () => {
      const result = await provider.getSecretJson("MISSING_JSON");

      expect(result).toBeUndefined();
    });

    it("should throw SecretsError for invalid JSON", async () => {
      process.env.INVALID_JSON = "not valid json";

      await expect(provider.getSecretJson("INVALID_JSON")).rejects.toThrow(
        SecretsError,
      );
    });

    it("should parse array JSON", async () => {
      process.env.ARRAY_SECRET = '["a","b","c"]';

      const result = await provider.getSecretJson<string[]>("ARRAY_SECRET");

      expect(result).toEqual(["a", "b", "c"]);
    });
  });
});

describe("getEnvSecret", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return secret from environment", () => {
    process.env.HELPER_SECRET = "helper-value";

    const result = getEnvSecret("HELPER_SECRET");

    expect(result).toBe("helper-value");
  });

  it("should return undefined for missing secret", () => {
    const result = getEnvSecret("MISSING_HELPER");

    expect(result).toBeUndefined();
  });
});

describe("getEnvSecretOrThrow", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return secret from environment", () => {
    process.env.REQUIRED_SECRET = "required-value";

    const result = getEnvSecretOrThrow("REQUIRED_SECRET");

    expect(result).toBe("required-value");
  });

  it("should throw for missing secret", () => {
    expect(() => getEnvSecretOrThrow("MISSING_REQUIRED")).toThrow(
      "Required secret not found in environment: MISSING_REQUIRED",
    );
  });
});
