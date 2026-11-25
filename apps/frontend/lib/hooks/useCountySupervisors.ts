"use client";

import { useMemo } from "react";
import { useQuery } from "@apollo/client/react";
import { useJurisdictions } from "@/components/region/JurisdictionsContext";
import {
  COUNTY_SUPERVISORS_AT,
  MY_COUNTY_SUPERVISORS,
  type CountySupervisorsAtData,
  type MyCountySupervisorsData,
  type Representative,
} from "@/lib/graphql/region";

const NONE: readonly Representative[] = [];

/**
 * The reader's Board of Supervisors, narrowed to their own seat when their
 * supervisorial district is known (#1136), signed in or not (#1456).
 *
 * Signed in, from the account's saved address (`myCountySupervisors`).
 * Signed out, from the district ids the visitor's device kept
 * (`countySupervisorsAt`), with `no-cache` so the persisted Apollo cache
 * never becomes a second copy of where they live. Only one of the two runs,
 * and the guarded one never runs for a visitor.
 */
export function useCountySupervisors(
  options: { readonly skip?: boolean } = {},
): readonly Representative[] {
  const { source, jurisdictions } = useJurisdictions();
  const skip = options.skip ?? false;

  const ids = useMemo(
    () => jurisdictions.map((j) => j.jurisdiction.id),
    [jurisdictions],
  );

  const account = useQuery<MyCountySupervisorsData>(MY_COUNTY_SUPERVISORS, {
    skip: skip || source !== "account",
  });
  const device = useQuery<CountySupervisorsAtData>(COUNTY_SUPERVISORS_AT, {
    variables: { ids },
    skip: skip || source !== "device" || ids.length === 0,
    fetchPolicy: "no-cache",
  });

  if (source === "account") return account.data?.myCountySupervisors ?? NONE;
  if (source === "device") return device.data?.countySupervisorsAt ?? NONE;
  return NONE;
}
