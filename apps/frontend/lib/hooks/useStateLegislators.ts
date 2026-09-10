import { useQuery } from "@apollo/client/react";
import {
  GET_REPRESENTATIVES_BY_DISTRICTS,
  type Representative,
  type RepresentativesByDistrictsData,
  type UserJurisdictionData,
} from "@/lib/graphql/region";
import { districtNumber, findByType } from "@/lib/region-stack";

/**
 * The reader's own state legislators, from their resolved districts.
 *
 * Shared by the stack index and the state layer page — the index card and
 * the page header show the same two people, and deriving them twice is how
 * the two drift apart.
 *
 * District numbers are compared as digits on both sides: jurisdictions are
 * named "California State Senate District 02" while the roster stores "2",
 * so a string compare silently finds nobody.
 */
export function useStateLegislators(
  jurisdictions: readonly UserJurisdictionData[],
): readonly Representative[] {
  const assembly = districtNumber(
    findByType(jurisdictions, "STATE_ASSEMBLY_DISTRICT")?.jurisdiction.name,
  );
  const senate = districtNumber(
    findByType(jurisdictions, "STATE_SENATE_DISTRICT")?.jurisdiction.name,
  );

  const { data } = useQuery<RepresentativesByDistrictsData>(
    GET_REPRESENTATIVES_BY_DISTRICTS,
    {
      variables: {
        stateAssemblyDistrict: assembly,
        stateSenatorialDistrict: senate,
      },
      skip: !assembly && !senate,
    },
  );

  return data?.representativesByDistricts ?? [];
}
