import { mockClient } from "aws-sdk-client-mock";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { ConfigService } from "@nestjs/config";
import {
  AWSSecretsProvider,
  getAWSSecret,
} from "../src/providers/aws-secrets.provider";
import { SecretsError } from "@opuspopuli/common";

const mockSecretsManager = mockClient(SecretsManagerClient);

describe("AWSSecretsProvider", () => {
  let provider: AWSSecretsProvider;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    mockSecretsManager.reset();

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "AWS_REGION" || key === "secrets.region")
          return "us-east-1";
        if (key === "secrets.cacheTTLSeconds") return 300;
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    provider = new AWSSecretsProvider(mockConfigService);
  });

  describe("constructor", () => {
    it("should initialize with region from config", () => {
      expect(provider.getName()).toBe("AWSSecretsProvider");
    });

    it("should throw SecretsError when region is not configured", () => {
      const noRegionConfig = {
        get: jest.fn(() => undefined),
      } as unknown as ConfigService;

      expect(() => new AWSSecretsProvider(noRegionConfig)).toThrow(
        SecretsError,
      );
    });
  });

  describe("getSecret", () => {
    it("should return secret from AWS", async () => {
      mockSecretsManager.on(GetSecretValueCommand).resolves({
        SecretString: "aws-secret-value",
      });

      const result = await provider.getSecret("my-secret");

      expect(result).toBe("aws-secret-value");
    });

    it("should return undefined for missing secret", async () => {
      mockSecretsManager.on(GetSecretValueCommand).rejects(
        new ResourceNotFoundException({
          message: "Secret not found",
          $metadata: {},
        }),
      );

      const result = await provider.getSecret("missing-secret");

      expect(result).toBeUndefined();
    });

    it("should throw SecretsError for other errors", async () => {
      mockSecretsManager
        .on(GetSecretValueCommand)
        .rejects(new Error("Network error"));

      await expect(provider.getSecret("error-secret")).rejects.toThrow(
        SecretsError,
      );
    });

    it("should return undefined when secret has no string value", async () => {
      mockSecretsManager.on(GetSecretValueCommand).resolves({
        SecretString: undefined,
      });

      const result = await provider.getSecret("binary-secret");

      expect(result).toBeUndefined();
    });
  });

  describe("caching", () => {
    it("should cache secrets", async () => {
      mockSecretsManager.on(GetSecretValueCommand).resolves({
        SecretString: "cached-value",
      });

      await provider.getSecret("cached-secret");
      await provider.getSecret("cached-secret");

      expect(mockSecretsManager.calls()).toHaveLength(1);
    });

    it("should clear specific cached secret", async () => {
      mockSecretsManager.on(GetSecretValueCommand).resolves({
        SecretString: "value-to-clear",
      });

      await provider.getSecret("clear-me");
      provider.clearCache("clear-me");
      await provider.getSecret("clear-me");

      expect(mockSecretsManager.calls()).toHaveLength(2);
    });

    it("should clear all cached secrets", async () => {
      mockSecretsManager.on(GetSecretValueCommand).resolves({
        SecretString: "value",
      });

      await provider.getSecret("secret-1");
      await provider.getSecret("secret-2");
      provider.clearCache();
      await provider.getSecret("secret-1");
      await provider.getSecret("secret-2");

      expect(mockSecretsManager.calls()).toHaveLength(4);
    });
  });

  describe("getSecrets", () => {
    it("should fetch multiple secrets in parallel", async () => {
      mockSecretsManager
        .on(GetSecretValueCommand, { SecretId: "secret-a" })
        .resolves({ SecretString: "value-a" })
        .on(GetSecretValueCommand, { SecretId: "secret-b" })
        .resolves({ SecretString: "value-b" });

      const result = await provider.getSecrets(["secret-a", "secret-b"]);

      expect(result).toEqual({
        "secret-a": "value-a",
        "secret-b": "value-b",
      });
    });

    it("should return undefined for failed secrets", async () => {
      mockSecretsManager
        .on(GetSecretValueCommand, { SecretId: "good-secret" })
        .resolves({ SecretString: "good-value" })
        .on(GetSecretValueCommand, { SecretId: "bad-secret" })
        .rejects(new Error("Failed"));

      const result = await provider.getSecrets(["good-secret", "bad-secret"]);

      expect(result).toEqual({
        "good-secret": "good-value",
        "bad-secret": undefined,
      });
    });
  });

  describe("getSecretJson", () => {
    it("should parse JSON secrets", async () => {
      mockSecretsManager.on(GetSecretValueCommand).resolves({
        SecretString: '{"key":"value","count":42}',
      });

      const result = await provider.getSecretJson<{
        key: string;
        count: number;
      }>("json-secret");

      expect(result).toEqual({ key: "value", count: 42 });
    });

    it("should return undefined for missing JSON secret", async () => {
      mockSecretsManager.on(GetSecretValueCommand).rejects(
        new ResourceNotFoundException({
          message: "Not found",
          $metadata: {},
        }),
      );

      const result = await provider.getSecretJson("missing-json");

      expect(result).toBeUndefined();
    });

    it("should throw SecretsError for invalid JSON", async () => {
      mockSecretsManager.on(GetSecretValueCommand).resolves({
        SecretString: "not valid json",
      });

      await expect(provider.getSecretJson("invalid-json")).rejects.toThrow(
        SecretsError,
      );
    });
  });
});

describe("getAWSSecret helper", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockSecretsManager.reset();
    process.env = { ...originalEnv, AWS_REGION: "us-west-2" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return secret from AWS", async () => {
    mockSecretsManager.on(GetSecretValueCommand).resolves({
      SecretString: "helper-secret-value",
    });

    const result = await getAWSSecret("helper-test");

    expect(result).toBe("helper-secret-value");
  });

  it("should use region from parameter", async () => {
    mockSecretsManager.on(GetSecretValueCommand).resolves({
      SecretString: "regional-value",
    });

    const result = await getAWSSecret("regional-secret", "eu-west-1");

    expect(result).toBe("regional-value");
  });

  it("should throw when region is not available", async () => {
    delete process.env.AWS_REGION;

    await expect(getAWSSecret("no-region")).rejects.toThrow(
      "AWS_REGION is required",
    );
  });

  it("should throw when secret has no string value", async () => {
    mockSecretsManager.on(GetSecretValueCommand).resolves({
      SecretString: undefined,
    });

    await expect(getAWSSecret("no-value")).rejects.toThrow(
      "has no string value",
    );
  });
});
