Opus Populi platform (NestJS/GraphQL/Next.js). Report high-confidence vulnerabilities only; ignore
theoretical issues, rate limiting and denial-of-service concerns. Check for:

1. SQL, NoSQL or command injection.
2. XSS via `dangerouslySetInnerHTML` or direct DOM manipulation.
3. SSRF: user-controlled URLs fetched by the server without host validation.
4. Authentication bypass, or missing HMAC or CSRF double-submit validation.
5. Hardcoded credentials, API keys or tokens.
6. Path traversal in file operations.
7. Insecure deserialization (`eval`, the `Function` constructor with user input).
8. California personal information (accounts, petition signatures, civic engagement records, street
   addresses, device and account identifiers) written to logs at any level, error messages,
   OpenTelemetry attributes, test fixtures or seed data without masking, or sent to a model in a
   prompt. Synthetic or faker data is fine.
