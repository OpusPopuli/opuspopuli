import { hydrateEnvFromVault } from "../src/bootstrap";

jest.mock("../src/providers/supabase-vault.provider", () => ({
  getSecrets: jest.fn(),
}));

import { getSecrets } from "../src/providers/supabase-vault.provider";

const mockGetSecrets = getSecrets as jest.MockedFunction<typeof getSecrets>;

describe("hydrateEnvFromVault", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("mode gating", () => {
    it("is a no-op when SECRETS_PROVIDER is unset (defaults to env)", async () => {
      delete process.env.SECRETS_PROVIDER;
      process.env.FOO = "from-env";

      await hydrateEnvFromVault(["FOO"]);

      expect(mockGetSecrets).not.toHaveBeenCalled();
      expect(process.env.FOO).toBe("from-env");
    });

    it("is a no-op when SECRETS_PROVIDER='env'", async () => {
      process.env.SECRETS_PROVIDER = "env";

      await hydrateEnvFromVault(["FOO"]);

      expect(mockGetSecrets).not.toHaveBeenCalled();
    });

    it("is case-insensitive on the mode value", async () => {
      process.env.SECRETS_PROVIDER = "SUPABASE";
      mockGetSecrets.mockResolvedValueOnce("v");

      await hydrateEnvFromVault(["FOO"]);

      expect(mockGetSecrets).toHaveBeenCalledWith("FOO");
    });

    it("is a no-op when the requested-secrets list is empty", async () => {
      process.env.SECRETS_PROVIDER = "supabase";

      await hydrateEnvFromVault([]);

      expect(mockGetSecrets).not.toHaveBeenCalled();
    });
  });

  describe("supabase mode hydration", () => {
    beforeEach(() => {
      process.env.SECRETS_PROVIDER = "supabase";
    });

    it("writes Vault values into process.env when env is unset", async () => {
      delete process.env.FOO;
      mockGetSecrets.mockResolvedValueOnce("from-vault");

      await hydrateEnvFromVault(["FOO"]);

      expect(mockGetSecrets).toHaveBeenCalledWith("FOO");
      expect(process.env.FOO).toBe("from-vault");
    });

    it("overwrites an existing env value with the Vault value (vault is authoritative)", async () => {
      process.env.FOO = "from-env";
      mockGetSecrets.mockResolvedValueOnce("from-vault");

      await hydrateEnvFromVault(["FOO"]);

      expect(process.env.FOO).toBe("from-vault");
    });

    it("hydrates multiple secrets in one call", async () => {
      mockGetSecrets
        .mockResolvedValueOnce("v-a")
        .mockResolvedValueOnce("v-b")
        .mockResolvedValueOnce("v-c");

      await hydrateEnvFromVault(["A", "B", "C"]);

      expect(process.env.A).toBe("v-a");
      expect(process.env.B).toBe("v-b");
      expect(process.env.C).toBe("v-c");
      expect(mockGetSecrets).toHaveBeenCalledTimes(3);
    });
  });

  describe("missing-secret tolerance", () => {
    beforeEach(() => {
      process.env.SECRETS_PROVIDER = "supabase";
    });

    it("does not throw when a single secret is missing from Vault", async () => {
      mockGetSecrets.mockRejectedValueOnce(new Error("Secret not found: FOO"));

      await expect(hydrateEnvFromVault(["FOO"])).resolves.not.toThrow();
    });

    it("leaves the existing env value in place when Vault throws", async () => {
      process.env.FOO = "from-env";
      mockGetSecrets.mockRejectedValueOnce(new Error("Secret not found: FOO"));

      await hydrateEnvFromVault(["FOO"]);

      expect(process.env.FOO).toBe("from-env");
    });

    it("continues hydrating remaining secrets after one fails (partial success)", async () => {
      mockGetSecrets
        .mockResolvedValueOnce("v-a")
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce("v-c");

      await hydrateEnvFromVault(["A", "B", "C"]);

      expect(process.env.A).toBe("v-a");
      expect(process.env.C).toBe("v-c");
      expect(mockGetSecrets).toHaveBeenCalledTimes(3);
    });
  });
});
