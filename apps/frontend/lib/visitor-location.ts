/**
 * A signed-out visitor's location, kept on their own device (#1456).
 *
 * Only district ids are stored: never the address or the coordinates they
 * came from, which are used once for `locateJurisdictions` and dropped. The
 * server keeps nothing, so this list is the visitor's only copy, and
 * clearing it removes the location entirely.
 *
 * Storage can be unavailable (private mode, quota, a blocked origin). Every
 * access is therefore wrapped: the region pages must render without it, and
 * the worst case is a visitor who has to locate again.
 */

export const VISITOR_LOCATION_KEY = "op-visitor-jurisdictions-v1";

/** The server's `jurisdictionsByIds` cap. More than this is not ours. */
export const MAX_VISITOR_JURISDICTIONS = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids that pass the server's own validation, deduplicated, capped. */
function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (v): v is string => typeof v === "string" && UUID_RE.test(v),
  );
  return Array.from(new Set(ids)).slice(0, MAX_VISITOR_JURISDICTIONS);
}

/** Fired on this tab after a write; `storage` covers the other tabs. */
const CHANGE_EVENT = "op-visitor-location-change";

/**
 * The stored value as a raw string, `""` when absent or unreadable. A string
 * so `useSyncExternalStore` can compare snapshots by value: parsing here
 * would hand React a new array on every call and loop the render.
 */
export function visitorLocationSnapshot(): string {
  try {
    return globalThis.localStorage?.getItem(VISITOR_LOCATION_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Subscribe to changes from this tab and others. Returns the unsubscribe. */
export function subscribeVisitorLocation(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === VISITOR_LOCATION_KEY) onChange();
  };
  globalThis.addEventListener?.("storage", onStorage);
  globalThis.addEventListener?.(CHANGE_EVENT, onChange);
  return () => {
    globalThis.removeEventListener?.("storage", onStorage);
    globalThis.removeEventListener?.(CHANGE_EVENT, onChange);
  };
}

/** Parse a snapshot into ids. Anything malformed reads as no location. */
export function parseVisitorJurisdictionIds(raw: string): string[] {
  if (!raw) return [];
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** The saved ids, or `[]` when there are none or storage can't be read. */
export function readVisitorJurisdictionIds(): string[] {
  return parseVisitorJurisdictionIds(visitorLocationSnapshot());
}

function announceChange(): void {
  globalThis.dispatchEvent?.(new Event(CHANGE_EVENT));
}

/** Saves the ids. Returns false when storage refused, so the caller knows
 *  the location will last only as long as the page. */
export function writeVisitorJurisdictionIds(ids: readonly string[]): boolean {
  try {
    globalThis.localStorage?.setItem(
      VISITOR_LOCATION_KEY,
      JSON.stringify(sanitize(ids)),
    );
  } catch {
    return false;
  }
  announceChange();
  return true;
}

export function clearVisitorJurisdictionIds(): void {
  try {
    globalThis.localStorage?.removeItem(VISITOR_LOCATION_KEY);
  } catch {
    // Nothing to do: if storage can't be written, nothing was kept in it.
    return;
  }
  announceChange();
}
