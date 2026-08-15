import { refreshSession, resetRefreshStateForTests } from "../lib/auth-refresh";

/**
 * The concurrency behaviour here is the whole point of the module, and it is
 * the part that cannot be checked by hand: a broken single-flight only shows
 * up when several queries fail at once, which is exactly the `/me/*` page load
 * that surfaced #977 in the first place.
 */
describe("auth-refresh", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    resetRefreshStateForTests();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    document.cookie = "csrf-token=test-csrf-value";
  });

  const respond = (status: number) => ({ ok: status === 204, status });

  describe("outcomes", () => {
    it("reports renewed on 204", async () => {
      fetchMock.mockResolvedValue(respond(204));
      await expect(refreshSession()).resolves.toBe("renewed");
    });

    it("reports expired on 401 — the session is genuinely dead", async () => {
      fetchMock.mockResolvedValue(respond(401));
      await expect(refreshSession()).resolves.toBe("expired");
    });

    // 503 must NOT read as expired. The backend goes to some trouble to
    // distinguish "sign in again" from "try again"; collapsing them here would
    // throw that away at the last layer and sign users out on a GoTrue blip.
    it("reports unavailable on 503 — not expired", async () => {
      fetchMock.mockResolvedValue(respond(503));
      await expect(refreshSession()).resolves.toBe("unavailable");
    });

    it("reports unavailable when the network call itself fails", async () => {
      fetchMock.mockRejectedValue(new Error("offline"));
      await expect(refreshSession()).resolves.toBe("unavailable");
    });
  });

  describe("single flight", () => {
    it("collapses concurrent callers into ONE request", async () => {
      let release!: (v: unknown) => void;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const all = Promise.all([
        refreshSession(),
        refreshSession(),
        refreshSession(),
        refreshSession(),
      ]);
      release(respond(204));

      expect(await all).toEqual(["renewed", "renewed", "renewed", "renewed"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("collapses concurrent callers on failure too", async () => {
      let release!: (v: unknown) => void;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const all = Promise.all([refreshSession(), refreshSession()]);
      release(respond(401));

      expect(await all).toEqual(["expired", "expired"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // The flip side: the latch must RELEASE. If it didn't, one refresh would
    // be the only refresh this tab ever performs, and the user would be logged
    // out 15 minutes later exactly as before.
    it("starts a new request once the previous one has settled", async () => {
      fetchMock.mockResolvedValue(respond(204));

      await refreshSession();
      await refreshSession();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("releases the latch even when the request throws", async () => {
      fetchMock.mockRejectedValueOnce(new Error("offline"));
      await expect(refreshSession()).resolves.toBe("unavailable");

      fetchMock.mockResolvedValue(respond(204));
      await expect(refreshSession()).resolves.toBe("renewed");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("request shape", () => {
    it("POSTs to the refresh endpoint with cookies attached", async () => {
      fetchMock.mockResolvedValue(respond(204));

      await refreshSession();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/auth/refresh");
      expect(init.method).toBe("POST");
      // Without this the httpOnly refresh cookie never leaves the browser.
      expect(init.credentials).toBe("include");
    });

    // CsrfMiddleware guards the gateway route via forRoutes({path:'*'}), so a
    // POST without this header is rejected before the handler runs.
    it("sends the CSRF token", async () => {
      fetchMock.mockResolvedValue(respond(204));

      await refreshSession();

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers["X-CSRF-Token"]).toBe("test-csrf-value");
    });
  });
});
