/**
 * HMAC Request Signer for Prompt Service
 *
 * Signs outbound requests using the prompt-service HMAC protocol.
 * The API key never leaves the node — each request is signed with a
 * timestamp and body hash for replay protection and tamper detection.
 *
 * NOTE: This is different from the gateway HmacSignerService which uses
 * X-HMAC-Auth with JSON credentials. The prompt-service protocol uses
 * separate X-HMAC-Signature/Timestamp/Key-Id headers with body hash.
 */

import { createHash, createHmac } from "node:crypto";

export interface HmacSigningConfig {
  /** The shared secret (node API key) */
  apiKey: string;
  /** Node UUID — sent as X-HMAC-Key-Id */
  nodeId: string;
}

export interface HmacHeaders {
  "X-HMAC-Signature": string;
  "X-HMAC-Timestamp": string;
  "X-HMAC-Key-Id": string;
}

/**
 * Sign a request using the prompt-service HMAC protocol.
 *
 * Signature string: `${timestamp}\n${method}\n${path}\n${bodyHash}`
 * Body hash: SHA-256 hex digest of the raw request body
 * Signature: Base64-encoded HMAC-SHA256 of the signature string
 */
export function signRequest(
  config: HmacSigningConfig,
  method: string,
  path: string,
  body: string,
): HmacHeaders {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signatureString = `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
  const signature = createHmac("sha256", config.apiKey)
    .update(signatureString)
    .digest("base64");

  return {
    "X-HMAC-Signature": signature,
    "X-HMAC-Timestamp": timestamp,
    "X-HMAC-Key-Id": config.nodeId,
  };
}
