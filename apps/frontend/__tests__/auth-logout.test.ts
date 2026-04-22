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

    it("returns true for GraphQL FORBIDDEN error", () => {
      const err = new CombinedGraphQLErrors({ data: null }, [
        { message: "Forbidden resource", extensions: { code: "FORBIDDEN" } },
      ]);
      expect(isAuthExpiredError(err)).toBe(true);
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

    it("clears localStorage, fires backend Logout, and redirects", () => {
      localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));

      triggerAuthExpiredRedirect("/settings/privacy");

      expect(localStorage.getItem(USER_KEY)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.operationName).toBe("Logout");
      expect(body.query).toContain("mutation Logout");
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
  });
});
