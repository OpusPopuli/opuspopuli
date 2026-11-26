/**
 * Where a `?redirect=` may send a reader after signing in: a path on this
 * site, or the fallback.
 *
 * Checking the string's shape isn't enough. `/\evil.com` starts with one
 * slash, not two, yet a browser resolves it to `https://evil.com/`, because
 * the URL parser treats a backslash as a slash. So the target is resolved
 * the way the browser will resolve it, and kept only if it stays on this
 * origin, and so must the normalised path that is returned (dot segments
 * can turn `/..//evil.com` into `//evil.com`). Shared by the login page and
 * the auth callback, which had two copies of the shape check (#1456).
 */

/** A stand-in origin: only "is it still this origin?" matters. */
const SELF = "https://self.invalid";

export function safeRedirect(raw: string | null, fallback: string): string {
  if (!raw?.startsWith("/")) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(raw, SELF);
  } catch {
    return fallback;
  }
  if (resolved.origin !== SELF) return fallback;

  // What we return is normalised, and normalising can itself produce an
  // escape: `/..//evil.com` resolves on this origin, but its path is
  // `//evil.com`, which a browser reads as another host. So the path we
  // hand back must stay on this origin too.
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  if (path.startsWith("//") || new URL(path, SELF).origin !== SELF) {
    return fallback;
  }
  return path;
}
