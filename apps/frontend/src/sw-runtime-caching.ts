import { CacheFirst, ExpirationPlugin, NetworkOnly } from "serwist";
import type { RuntimeCaching } from "serwist";

/**
 * Runtime-caching rules, in precedence order (#1092).
 *
 * Serwist returns the FIRST matching route, so order is the whole contract.
 * These are composed ahead of `defaultCache` in `sw.ts`; previously
 * `defaultCache` was spread first and shadowed everything below it, which made
 * the images rule unreachable even in principle — `defaultCache` ships its own
 * static-image-assets rule that matched first.
 *
 * Kept out of `sw.ts` so the ordering can be tested without importing
 * `@serwist/next/worker`, and — more importantly — so the rules live in a file
 * `tsconfig.json` actually includes. `src/sw.ts` is excluded from the program,
 * which is how the previous version shipped three rules that could never fire.
 *
 * ── Two ways these rules were dead ───────────────────────────────────────
 *
 * 1. Every rule declared `urlPattern`. `RuntimeCaching` requires `matcher`;
 *    `urlPattern` is not a member of it.
 * 2. `handler` was a string — `"NetworkOnly"`, `"CacheFirst"`. `RouteHandler`
 *    is `RouteHandlerCallback | RouteHandlerObject`, i.e. something with a
 *    `handle` method. A string satisfies neither, and once the matchers were
 *    corrected the strings would have become reachable and thrown
 *    `handler.handle is not a function` on every matching request.
 *
 * The second is the more dangerous, because fixing only the first makes it
 * live. No cast here on purpose: the types are the check.
 *
 * ── The GraphQL rule that used to be here ────────────────────────────────
 *
 * Deleted rather than repaired. It aimed at `/graphql`; the gateway serves
 * `/api`. Repointing it would have been worse than leaving it dead — `/api`
 * also matches `/api/auth/refresh` and `/api/auth/logout`, and first-match-wins
 * would have handed auth endpoints NetworkFirst caching in spite of the
 * NetworkOnly rule below.
 *
 * It is deleted rather than corrected because GraphQL cannot be runtime-cached
 * here at all: the traffic is POST, which runtime caching does not route, and
 * Apollo Client already persists its normalized cache to IndexedDB. A second
 * cache in the service worker would invalidate on different rules and disagree
 * with it.
 */
export const customRuntimeCaching: RuntimeCaching[] = [
  // Auth — never cache. FIRST on purpose: any broader rule above this line
  // silently captures credential traffic, which is why ordering has a test
  // rather than a comment.
  {
    matcher: /\/(auth|login|logout|register)/,
    handler: new NetworkOnly(),
  },
  // Images — cache first. Ahead of defaultCache so it is reachable at all.
  {
    matcher: /\.(png|jpg|jpeg|svg|gif|webp|ico)$/,
    handler: new CacheFirst({
      cacheName: "images",
      plugins: [
        new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 2592000 }),
      ],
    }),
  },
];
