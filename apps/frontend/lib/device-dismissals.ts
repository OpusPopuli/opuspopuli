/**
 * Notices a reader has dismissed, remembered on their own device (#1456).
 *
 * One key holding a comma-separated list, so each notice is a name rather
 * than a key of its own. Storage can be unavailable; reads then say "not
 * dismissed" and writes say they failed, and the caller keeps the
 * dismissal for the page's life instead.
 */

const DISMISSED_KEY = "op-dismissed-notices-v1";

/** The raw stored list, `""` when absent or unreadable. */
export function dismissedSnapshot(): string {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) ?? "";
  } catch {
    return "";
  }
}

export function isDismissed(snapshot: string, name: string): boolean {
  return snapshot.split(",").includes(name);
}

/** Remember a dismissal. Returns false when storage refused. */
export function rememberDismissed(name: string): boolean {
  try {
    const names = new Set(dismissedSnapshot().split(",").filter(Boolean));
    names.add(name);
    globalThis.localStorage?.setItem(
      DISMISSED_KEY,
      Array.from(names).join(","),
    );
    return true;
  } catch {
    return false;
  }
}

/** For useSyncExternalStore: dismissals don't need live cross-tab updates. */
export const noDismissalSubscription = () => () => {};

/** Unknown on the server and while hydrating, so a notice renders hidden. */
export const dismissedServerSnapshot = () => null;
