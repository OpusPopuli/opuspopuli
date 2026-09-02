/**
 * Service worker runtime-caching precedence (#1092).
 *
 * These rules had never worked. Two independent reasons, and the second is why
 * nobody noticed the first:
 *
 *   1. Every rule declared `urlPattern`. Serwist's `RuntimeCaching` interface
 *      requires `matcher` — `urlPattern` is not a member of it, so all three
 *      rules were inert, not merely mis-pointed.
 *   2. `tsconfig.json` excludes `src/sw.ts`, so no type error was ever raised.
 *
 * Extracting the rules into a module the tsconfig DOES include is the durable
 * half of the fix; these tests are the half that survives someone moving them
 * back.
 */
/*
 * `serwist` is ESM-only and Jest does not transform it (pnpm's nested paths
 * make a transformIgnorePatterns exception brittle). Mocking it keeps this
 * test about OUR configuration — order, matchers, and handler SHAPE.
 *
 * The real strategy types are checked by tsc: sw-runtime-caching.ts carries no
 * cast, so `handler: "NetworkOnly"` would fail the build rather than this test.
 * That division matters — the previous version used `as unknown as
 * RuntimeCaching[]`, and the cast is what let a string handler through.
 */
jest.mock("serwist", () => {
  class FakeStrategy {
    constructor(public options?: unknown) {}
    handle() {
      return Promise.resolve(new Response(""));
    }
  }
  return {
    NetworkOnly: class NetworkOnly extends FakeStrategy {},
    CacheFirst: class CacheFirst extends FakeStrategy {},
    ExpirationPlugin: class ExpirationPlugin {
      constructor(public options?: unknown) {}
    },
  };
});

import { customRuntimeCaching } from "../src/sw-runtime-caching";

/** Serwist returns the first matching route, so precedence is registration order. */
function firstMatch(url: string) {
  return customRuntimeCaching.find((rule) => {
    const matcher = (rule as unknown as { matcher: RegExp }).matcher;
    return matcher instanceof RegExp && matcher.test(url);
  });
}

/** The strategy class name, e.g. "NetworkOnly" — not a string from the config. */
const handlerOf = (url: string) => firstMatch(url)?.handler?.constructor?.name;

describe("service worker runtime caching (#1092)", () => {
  it("declares every rule with `matcher`, never `urlPattern`", () => {
    // Defect one. `urlPattern` is not a member of RuntimeCaching, and
    // `src/sw.ts` is excluded from tsconfig, so this shipped silently.
    for (const rule of customRuntimeCaching) {
      expect(rule).toHaveProperty("matcher");
      expect(rule).not.toHaveProperty("urlPattern");
    }
  });

  it("gives every rule a real Strategy, not a handler string", () => {
    // Defect two, and the dangerous one: fixing only the matchers would have
    // made these reachable, and a string handler throws
    // `handler.handle is not a function` on every request it matches. The
    // rules being dead is what hid it.
    for (const rule of customRuntimeCaching) {
      expect(typeof rule.handler).toBe("object");
      expect(typeof (rule.handler as { handle?: unknown }).handle).toBe(
        "function",
      );
    }
  });

  it("never caches auth traffic", () => {
    for (const path of [
      "/api/auth/refresh",
      "/api/auth/logout",
      "/login",
      "/register",
    ]) {
      expect(handlerOf(path)).toBe("NetworkOnly");
    }
  });

  it("puts the auth rule ahead of every other rule", () => {
    // Ordering IS the guarantee: a broader rule registered above this one
    // captures credential traffic, and first-match-wins means the NetworkOnly
    // rule below it never runs. That is how the obvious fix to the GraphQL
    // pattern would have introduced a real bug.
    const authIndex = customRuntimeCaching.findIndex(
      (r) => r.handler?.constructor?.name === "NetworkOnly",
    );
    expect(authIndex).toBe(0);
  });

  it("keeps the images rule reachable", () => {
    expect(handlerOf("/icons/logo.png")).toBe("CacheFirst");
    expect(handlerOf("/photo.webp")).toBe("CacheFirst");
  });

  it("claims no GraphQL traffic", () => {
    // The deleted rule pointed at /graphql, which the gateway does not serve —
    // it serves /api. Repointing it would have swallowed /api/auth/*, and
    // GraphQL is POST, which runtime caching does not route anyway.
    expect(firstMatch("/api")).toBeUndefined();
    expect(handlerOf("/graphql")).toBeUndefined();
  });

  it("does not intercept an image path under /api/auth", () => {
    // Guards the interaction between the two rules: auth wins, because a
    // cached credential response is worse than an uncached avatar.
    expect(handlerOf("/api/auth/avatar.png")).toBe("NetworkOnly");
  });
});
