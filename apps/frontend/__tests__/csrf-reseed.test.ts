/**
 * CSRF token re-seeding (#1089).
 *
 * A missing `csrf-token` cookie used to escalate into a forced logout:
 *
 *   cookie absent -> transport sends a bare POST -> 403
 *   -> `isAuthExpiredError` counts a network 403 as an expired session
 *   -> renewal runs, operation retried once
 *   -> the retry still has no token -> 403 again
 *   -> terminal handler clears local state and redirects to /login
 *
 * The user is signed out of a session that was never invalid. Production logs
 * for #1089 show that shape — five consecutive CSRF 403s.
 *
 * It is recoverable in one request: `CsrfMiddleware` sets or refreshes the
 * cookie on EVERY response and treats GET as safe, so the re-seeding GET
 * cannot itself be rejected for lacking the token.
 */
import { ensureCsrfToken, getCsrfToken } from "../lib/csrf";

const GRAPHQL_URL = "http://localhost:3000/api";

function setCookie(value: string | null) {
  Object.defineProperty(document, "cookie", {
    get: () => (value === null ? "" : value),
    configurable: true,
  });
}

describe("ensureCsrfToken (#1089)", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    setCookie(null);
  });

  it("returns the existing token without a network call", async () => {
    setCookie("csrf-token=abc123; other=x");

    await expect(ensureCsrfToken(GRAPHQL_URL)).resolves.toBe("abc123");

    // The common path must not pay for a request. Every GraphQL operation
    // goes through here.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-seeds with a GET when the cookie is absent", async () => {
    let cookie: string | null = null;
    Object.defineProperty(document, "cookie", {
      get: () => cookie ?? "",
      configurable: true,
    });
    // The gateway sets the cookie on its response; emulate that landing.
    fetchMock.mockImplementation(async () => {
      cookie = "csrf-token=seeded-by-gateway";
      return { ok: true, status: 200 };
    });

    await expect(ensureCsrfToken(GRAPHQL_URL)).resolves.toBe(
      "seeded-by-gateway",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GRAPHQL_URL);
    // GET is what makes this safe: CsrfMiddleware skips validation for it, so
    // the recovery request cannot be rejected for the very thing it recovers.
    expect(init.method).toBe("GET");
    // Without credentials the Set-Cookie would not apply and this would loop.
    expect(init.credentials).toBe("include");
  });

  it("returns undefined rather than throwing when the gateway is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    // The caller decides. Throwing here would be indistinguishable from a
    // CSRF rejection and would lose the real cause.
    await expect(ensureCsrfToken(GRAPHQL_URL)).resolves.toBeUndefined();
  });

  it("returns undefined when the gateway responds without setting a cookie", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await expect(ensureCsrfToken(GRAPHQL_URL)).resolves.toBeUndefined();
    // One attempt only — a retry loop against a gateway that will not set the
    // cookie is worse than a clean failure.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("getCsrfToken still reads a token that is present", () => {
    setCookie("a=1; csrf-token=plain; b=2");
    expect(getCsrfToken()).toBe("plain");
  });
});
