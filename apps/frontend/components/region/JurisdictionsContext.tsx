"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@apollo/client/react";
import {
  MY_JURISDICTIONS,
  type MyJurisdictionsData,
  type UserJurisdictionData,
} from "@/lib/graphql/region";

const JurisdictionsContext = createContext<readonly UserJurisdictionData[]>([]);

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
 * Consumers get an empty array outside the provider, which the breadcrumb
 * treats as "not known yet" and falls back to the level word.
 */
export function JurisdictionsProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { data } = useQuery<MyJurisdictionsData>(MY_JURISDICTIONS);
  const value = useMemo(
    () => data?.myJurisdictions ?? [],
    [data?.myJurisdictions],
  );
  return (
    <JurisdictionsContext.Provider value={value}>
      {children}
    </JurisdictionsContext.Provider>
  );
}

export function useJurisdictions(): readonly UserJurisdictionData[] {
  return useContext(JurisdictionsContext);
}
