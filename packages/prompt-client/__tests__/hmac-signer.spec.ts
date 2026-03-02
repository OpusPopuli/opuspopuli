import { createHash, createHmac } from "node:crypto";
import { signRequest, type HmacSigningConfig } from "../src/hmac-signer.js";

describe("signRequest", () => {
  const config: HmacSigningConfig = {
    apiKey: "test-secret-key-abc123",
    nodeId: "node-uuid-1234",
  };

  it("should return all three HMAC headers", () => {
    const headers = signRequest(
      config,
      "POST",
      "/prompts/rag",
      '{"query":"test"}',
    );

    expect(headers).toHaveProperty("X-HMAC-Signature");
    expect(headers).toHaveProperty("X-HMAC-Timestamp");
    expect(headers).toHaveProperty("X-HMAC-Key-Id");
  });

  it("should set X-HMAC-Key-Id to the node ID", () => {
    const headers = signRequest(config, "POST", "/prompts/rag", "{}");

    expect(headers["X-HMAC-Key-Id"]).toBe("node-uuid-1234");
  });

  it("should produce a valid Base64 signature", () => {
    const headers = signRequest(config, "POST", "/prompts/rag", "{}");
    const decoded = Buffer.from(headers["X-HMAC-Signature"], "base64");

    // HMAC-SHA256 produces 32 bytes
    expect(decoded.length).toBe(32);
  });

  it("should set timestamp to current unix seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = signRequest(config, "POST", "/prompts/rag", "{}");
    const after = Math.floor(Date.now() / 1000);

    const timestamp = parseInt(headers["X-HMAC-Timestamp"], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("should uppercase the method in the signature string", () => {
    const body = '{"test":"data"}';
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Manually compute what the signature should be with uppercase POST
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const signatureString = `${timestamp}\nPOST\n/prompts/rag\n${bodyHash}`;
    const expected = createHmac("sha256", config.apiKey)
      .update(signatureString)
      .digest("base64");

    // Mock Date.now to control timestamp
    const dateSpy = jest
      .spyOn(Date, "now")
      .mockReturnValue(parseInt(timestamp) * 1000);
    const headers = signRequest(config, "post", "/prompts/rag", body);
    dateSpy.mockRestore();

    expect(headers["X-HMAC-Signature"]).toBe(expected);
  });

  it("should produce different signatures for different bodies", () => {
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(1700000000000);

    const headers1 = signRequest(
      config,
      "POST",
      "/prompts/rag",
      '{"query":"one"}',
    );
    const headers2 = signRequest(
      config,
      "POST",
      "/prompts/rag",
      '{"query":"two"}',
    );

    dateSpy.mockRestore();

    expect(headers1["X-HMAC-Signature"]).not.toBe(headers2["X-HMAC-Signature"]);
  });

  it("should produce different signatures for different paths", () => {
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(1700000000000);

    const headers1 = signRequest(config, "POST", "/prompts/rag", "{}");
    const headers2 = signRequest(
      config,
      "POST",
      "/prompts/document-analysis",
      "{}",
    );

    dateSpy.mockRestore();

    expect(headers1["X-HMAC-Signature"]).not.toBe(headers2["X-HMAC-Signature"]);
  });

  it("should produce different signatures for different API keys", () => {
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(1700000000000);
    const body = "{}";
    const path = "/prompts/rag";

    const headers1 = signRequest(config, "POST", path, body);
    const headers2 = signRequest(
      { apiKey: "different-key", nodeId: "node-uuid-1234" },
      "POST",
      path,
      body,
    );

    dateSpy.mockRestore();

    expect(headers1["X-HMAC-Signature"]).not.toBe(headers2["X-HMAC-Signature"]);
  });
});
