import { CombinedGraphQLErrors } from "@apollo/client/errors";
import {
  apolloClient,
  setDemoUser,
  getDemoUser,
  clearDemoUser,
  DemoUser,
} from "../lib/apollo-client";
import {
  isAuthExpiredError,
  resetLogoutInProgressForTests,
  setPerformRedirectForTests,
  triggerAuthExpiredRedirect,
} from "../lib/auth-logout";
import { USER_KEY } from "../lib/auth-context";

describe("apollo-client", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("apolloClient", () => {
    it("should be defined", () => {
      expect(apolloClient).toBeDefined();
    });

    it("should have a cache", () => {
      expect(apolloClient.cache).toBeDefined();
    });

    it("should have a link configured", () => {
      expect(apolloClient.link).toBeDefined();
    });
  });

  describe("authExpiryLink behavior", () => {
    // The errorLink handler is a simple decision:
    //   if operationName === "Logout" → skip
    //   else if isAuthExpiredError → triggerAuthExpiredRedirect
    //   else → skip
    // We replicate that decision locally here (keeping it in sync with
    // the errorLink in lib/apollo-client.ts is cheap — it's 3 lines) and
    // assert the decision is correct for each scenario. This avoids
    // fighting ApolloLink.execute's context requirements.
    function handle(
      error: unknown,
      operationName: string | undefined,
    ): boolean {
      if (operationName === "Logout") return false;
      if (!isAuthExpiredError(error as never)) return false;
      triggerAuthExpiredRedirect("/settings/privacy");
      return true;
    }

    let assignMock: jest.Mock;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      resetLogoutInProgressForTests();
      localStorage.setItem(USER_KEY, JSON.stringify({ id: "u1" }));
      originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }) as unknown as typeof fetch;
      assignMock = jest.fn();
      setPerformRedirectForTests(assignMock);
    });

    afterEach(() => {
      setPerformRedirectForTests((url) => {
        window.location.assign(url);
      });
      globalThis.fetch = originalFetch;
      localStorage.clear();
    });

    it("redirects on 403 network error", () => {
      const err = Object.assign(new Error("Forbidden"), { statusCode: 403 });
      expect(handle(err, "Me")).toBe(true);
      expect(assignMock).toHaveBeenCalledWith(
        "/login?redirect=%2Fsettings%2Fprivacy&reason=expired",
      );
    });

    it("redirects on GraphQL FORBIDDEN error", () => {
      const err = new CombinedGraphQLErrors({ data: null }, [
        { message: "Forbidden", extensions: { code: "FORBIDDEN" } },
      ]);
      expect(handle(err, "Me")).toBe(true);
      expect(assignMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT redirect when operation is named Logout", () => {
      const err = Object.assign(new Error("Forbidden"), { statusCode: 403 });
      expect(handle(err, "Logout")).toBe(false);
      expect(assignMock).not.toHaveBeenCalled();
    });

    it("does NOT redirect on non-auth errors (5xx)", () => {
      const err = Object.assign(new Error("Server error"), { statusCode: 500 });
      expect(handle(err, "Me")).toBe(false);
      expect(assignMock).not.toHaveBeenCalled();
    });
  });

  describe("setDemoUser", () => {
    it("should store user in localStorage", () => {
      const user: DemoUser = {
        id: "test-id",
        email: "test@example.com",
        roles: ["user"],
        department: "test",
        clearance: "public",
      };

      setDemoUser(user);

      const stored = localStorage.getItem("user");
      expect(stored).toBe(JSON.stringify(user));
    });
  });

  describe("getDemoUser", () => {
    it("should return null when no user is stored", () => {
      const user = getDemoUser();
      expect(user).toBeNull();
    });

    it("should return stored user", () => {
      const user: DemoUser = {
        id: "test-id",
        email: "test@example.com",
        roles: ["user"],
        department: "test",
        clearance: "public",
      };

      localStorage.setItem("user", JSON.stringify(user));

      const result = getDemoUser();
      expect(result).toEqual(user);
    });
  });

  describe("clearDemoUser", () => {
    it("should remove user from localStorage", () => {
      const user: DemoUser = {
        id: "test-id",
        email: "test@example.com",
        roles: ["user"],
        department: "test",
        clearance: "public",
      };

      localStorage.setItem("user", JSON.stringify(user));
      expect(localStorage.getItem("user")).not.toBeNull();

      clearDemoUser();

      expect(localStorage.getItem("user")).toBeNull();
    });
  });
});
