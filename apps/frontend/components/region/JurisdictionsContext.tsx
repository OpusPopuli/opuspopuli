"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery } from "@apollo/client/react";
import { useAuth } from "@/lib/auth-context";
import {
  JURISDICTIONS_BY_IDS,
  MY_JURISDICTIONS,
  type JurisdictionData,
  type JurisdictionsByIdsData,
  type MyJurisdictionsData,
  type UserJurisdictionData,
} from "@/lib/graphql/region";
import {
  clearVisitorJurisdictionIds,
  parseVisitorJurisdictionIds,
  subscribeVisitorLocation,
  visitorLocationSnapshot,
  writeVisitorJurisdictionIds,
} from "@/lib/visitor-location";

/**
 * Where the reader's districts came from: their account's saved address, or
 * a location a visitor set on this device (#1456). `null` while sign-in
 * state is still being read, when neither query should run yet.
 */
export type JurisdictionSource = "account" | "device" | null;

export interface JurisdictionsState {
  readonly jurisdictions: readonly UserJurisdictionData[];
  readonly loading: boolean;
  readonly error: unknown;
  readonly source: JurisdictionSource;
  /** A visitor's located districts. Ignored when signed in, where the
   *  location is the account's address and changes in settings. */
  readonly setLocation: (jurisdictions: readonly JurisdictionData[]) => void;
  /** Forget a visitor's location on this device. */
  readonly clearLocation: () => void;
}

const noop = () => {};

const JurisdictionsContext = createContext<JurisdictionsState>({
  jurisdictions: [],
  loading: false,
  error: null,
  source: null,
  setLocation: noop,
  clearLocation: noop,
});

/** A device location in the shape the region pages already read. */
function fromDevice(rows: readonly JurisdictionData[]): UserJurisdictionData[] {
  return rows.map((jurisdiction) => ({
    resolvedBy: "device",
    resolvedAt: "",
    jurisdiction,
  }));
}

/** No snapshot on the server: the location is unknown until hydration. */
const serverSnapshot = () => null;

function sourceOf(authLoading: boolean, signedIn: boolean): JurisdictionSource {
  if (authLoading) return null;
  return signedIn ? "account" : "device";
}

/** A location `setLocation` was given, and whether storage accepted it. */
interface Located {
  readonly rows: readonly JurisdictionData[];
  readonly persisted: boolean;
}

/**
 * Whether the rows just located still describe this device's location. A
 * persisted location is superseded when storage changes under it (cleared
 * or replaced in another tab); one storage refused lasts the page's life.
 */
function stillCurrent(located: Located | null, storedIds: readonly string[]) {
  if (!located) return false;
  if (!located.persisted) return true;
  const ids = new Set(located.rows.map((r) => r.id));
  return ids.size === storedIds.length && storedIds.every((id) => ids.has(id));
}

/**
 * The reader's resolved jurisdictions, fetched once for the whole region
 * section.
 *
 * This exists so the breadcrumb can name the government it is pointing at
 * ("Sonoma County", not "County") without every page that renders a trail
 * firing its own query. An earlier version put `useQuery` inside
 * `<Breadcrumb>` and it rippled: fourteen pages gained a query they did not
 * ask for, and every test asserting on query variables or call order broke,
 * because the component under test was no longer the only caller.
 *
 * `loading` is exposed so the four region pages can render their skeletons
 * from this one query instead of each opening a second watched query for
 * the same data — which is what they did before, five in total.
 *
 * Signed out (#1456), the districts are the ids a visitor's device kept,
 * restored with `jurisdictionsByIds`. That query and the stored ids are the
 * only copies: `no-cache` keeps the rows out of the persisted Apollo cache,
 * so clearing the location clears it everywhere. `myJurisdictions` never
 * runs for a visitor, whose 401 would otherwise start a session refresh.
 *
 * Consumers get an empty array outside the provider, which the breadcrumb
 * treats as "not known yet" and falls back to the level word.
 */
export function JurisdictionsProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const source = sourceOf(authLoading, isAuthenticated);

  const account = useQuery<MyJurisdictionsData>(MY_JURISDICTIONS, {
    skip: source !== "account",
  });

  // A string snapshot, compared by value; null on the server and during
  // hydration so the first client render matches the server's.
  const stored = useSyncExternalStore(
    subscribeVisitorLocation,
    visitorLocationSnapshot,
    serverSnapshot,
  );
  const storedIds = useMemo(
    () => (stored === null ? [] : parseVisitorJurisdictionIds(stored)),
    [stored],
  );

  // What `setLocation` was just given. Spares a round trip right after a
  // lookup, and keeps the location for the page's life when storage refuses.
  const [located, setLocated] = useState<Located | null>(null);
  const current = stillCurrent(located, storedIds);

  const device = useQuery<JurisdictionsByIdsData>(JURISDICTIONS_BY_IDS, {
    variables: { ids: storedIds },
    skip: source !== "device" || current || storedIds.length === 0,
    fetchPolicy: "no-cache",
  });

  const setLocation = useCallback(
    (rows: readonly JurisdictionData[]) => {
      if (source !== "device") return;
      const persisted = writeVisitorJurisdictionIds(rows.map((r) => r.id));
      setLocated({ rows, persisted });
    },
    [source],
  );

  const clearLocation = useCallback(() => {
    setLocated(null);
    clearVisitorJurisdictionIds();
  }, []);

  const value = useMemo<JurisdictionsState>(() => {
    const shared = { source, setLocation, clearLocation };
    if (source === "account") {
      return {
        ...shared,
        jurisdictions: account.data?.myJurisdictions ?? [],
        loading: account.loading,
        error: account.error,
      };
    }
    if (source === "device") {
      const rows = current
        ? (located?.rows ?? [])
        : (device.data?.jurisdictionsByIds ?? []);
      return {
        ...shared,
        jurisdictions: fromDevice(rows),
        loading: stored === null || device.loading,
        error: device.error,
      };
    }
    return { ...shared, jurisdictions: [], loading: true, error: null };
  }, [
    source,
    setLocation,
    clearLocation,
    account.data?.myJurisdictions,
    account.loading,
    account.error,
    located,
    current,
    device.data?.jurisdictionsByIds,
    device.loading,
    device.error,
    stored,
  ]);

  return (
    <JurisdictionsContext.Provider value={value}>
      {children}
    </JurisdictionsContext.Provider>
  );
}

export function useJurisdictions(): JurisdictionsState {
  return useContext(JurisdictionsContext);
}
