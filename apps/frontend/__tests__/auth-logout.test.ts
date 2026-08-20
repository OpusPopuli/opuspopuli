import { CombinedGraphQLErrors } from "@apollo/client/errors";
import {
  isAuthExpiredError,
  resetLogoutInProgressForTests,
  setPerformRedirectForTests,
  triggerAuthExpiredRedirect,
} from "../lib/auth-logout";
import { USER_KEY } from "../lib/auth-context";

describe("auth-logout", () => {
  describe("isAuthExpiredError", () => {
    it("returns false for undefined / null", () => {
      expect(isAuthExpiredError(undefined)).toBe(false);
      // @ts-expect-error — runtime guard covers null too
      expect(isAuthExpiredError(null)).toBe(false);
    });

    it("returns false for GraphQL FORBIDDEN error", () => {
      // FORBIDDEN is a genuine authorization denial (the user is signed in but
      // lacks permission for this operation), NOT an expired session. Treating
      // it as expiry logged users out of the whole app for one denied query —
      // the conflation the backend guard split fixes. Only UNAUTHENTICATED and
      // network 401/403 end the session now.
      const err = new CombinedGraphQLErrors({ data: null }, [
        { message: "Forbidden resource", extensions: { code: "FORBIDDEN" } },
      ]);
      expect(isAuthExpiredError(err)).toBe(false);
    });

    it("returns true for GraphQL UNAUTHENTICATED error", () => {
      const err = new CombinedGraphQLErrors({ data: null }, [
        {
          message: "Not authenticated",
          extensions: { code: "UNAUTHENTICATED" },
        },
      ]);
      expect(isAuthExpiredError(err)).toBe(true);
    });

    it("returns false for BAD_USER_INPUT or other business errors", () => {
      const err = new CombinedGraphQLErrors({ data: null }, [
        { message: "Invalid", extensions: { code: "BAD_USER_INPUT" } },
      ]);
      expect(isAuthExpiredError(err)).toBe(false);
    });

    it("returns true for 403 network error", () => {
      const err = Object.assign(new Error("Request failed"), {
        statusCode: 403,
      });
      expect(isAuthExpiredError(err)).toBe(true);
    });

    it("returns true for 401 network error", () => {
      const err = Object.assign(new Error("Unauthorized"), {
        statusCode: 401,
      });
      expect(isAuthExpiredError(err)).toBe(true);
    });

    it("returns false for 500 network error", () => {
      const err = Object.assign(new Error("Server error"), {
        statusCode: 500,
      });
      expect(isAuthExpiredError(err)).toBe(false);
    });
  });

  describe("triggerAuthExpiredRedirect", () => {
    let assignMock: jest.Mock;
    let fetchMock: jest.Mock;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      resetLogoutInProgressForTests();
      localStorage.clear();

      originalFetch = globalThis.fetch;
      fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      assignMock = jest.fn();
      setPerformRedirectForTests(assignMock);
    });

    afterEach(() => {
      // Restore the production implementation
      setPerformRedirectForTests((url) => {
        globalThis.location.assign(url);
      });
      globalThis.fetch = originalFetch;
    });

    it("clears localStorage, calls the logout route, and redirects", () => {
      localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));

      triggerAuthExpiredRedirect("/settings/privacy");

      expect(localStorage.getItem(USER_KEY)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The REST route, not `mutation Logout { logout }`. That mutation is
      // auth-guarded, so on this path — reached only when the session has
      // ALREADY expired — it could never have passed the guard, and it was
      // sent without an X-CSRF-Token header so the gateway rejected it 403
      // first regardless. Either way the httpOnly cookies were never cleared
      // and the user stayed signed in. Asserting the URL rather than a request
      // body is the point: there is no body, because the cookie is the
      // credential.
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toMatch(/\/auth\/logout$/);
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).credentials).toBe("include");
      expect((init as RequestInit).body).toBeUndefined();

      expect(assignMock).toHaveBeenCalledWith(
        "/login?redirect=%2Fsettings%2Fprivacy&reason=expired",
      );
    });

    it("is idempotent — concurrent calls collapse to one navigation", () => {
      localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));

      triggerAuthExpiredRedirect("/a");
      triggerAuthExpiredRedirect("/b");
      triggerAuthExpiredRedirect("/c");

      expect(assignMock).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith(
        "/login?redirect=%2Fa&reason=expired",
      );
    });

    it("is a no-op when user is not logged in (public-page gate)", () => {
      // localStorage deliberately empty — user was never logged in
      triggerAuthExpiredRedirect("/region/propositions");

      expect(assignMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("encodes special characters in the redirect path", () => {
      localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));

      triggerAuthExpiredRedirect("/settings?tab=privacy&mode=view");

      expect(assignMock).toHaveBeenCalledWith(
        "/login?redirect=%2Fsettings%3Ftab%3Dprivacy%26mode%3Dview&reason=expired",
      );
    });

    it("swallows backend logout fetch failures silently", async () => {
      localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));
      fetchMock.mockRejectedValueOnce(new Error("network unreachable"));

      // Should not throw
      expect(() => triggerAuthExpiredRedirect("/x")).not.toThrow();
      // And redirect still happens
      expect(assignMock).toHaveBeenCalledTimes(1);
      // Let the fire-and-forget resolve without unhandled rejection
      await Promise.resolve();
    });

    describe("auth-route loop guard", () => {
      it("does NOT redirect when already on /login", () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));

        triggerAuthExpiredRedirect("/login");

        // Stale auth state still cleared for safety
        expect(localStorage.getItem(USER_KEY)).toBeNull();
        // But no navigation — we're already on the login page
        expect(assignMock).not.toHaveBeenCalled();
        // And no backend logout POST — we're on a public route
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("does NOT redirect when on /login with query params", () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));
        triggerAuthExpiredRedirect("/login?redirect=%2Fsettings");
        expect(assignMock).not.toHaveBeenCalled();
      });

      it("does NOT redirect when already on /register", () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));
        triggerAuthExpiredRedirect("/register");
        expect(assignMock).not.toHaveBeenCalled();
      });

      it("does NOT redirect when on /auth/callback", () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));
        triggerAuthExpiredRedirect("/auth/callback");
        expect(assignMock).not.toHaveBeenCalled();
      });

      it("DOES redirect from a non-auth route with auth_user set", () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));

        triggerAuthExpiredRedirect("/settings/privacy");

        expect(assignMock).toHaveBeenCalledWith(
          "/login?redirect=%2Fsettings%2Fprivacy&reason=expired",
        );
      });
    });
  });
});
