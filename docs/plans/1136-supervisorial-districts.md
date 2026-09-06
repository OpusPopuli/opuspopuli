# #1136 — Supervisorial districts, Sonoma pilot

| | |
|---|---|
| **Issue** | [#1136](https://github.com/OpusPopuli/opuspopuli/issues/1136) |
| **Date** | 2026-09-05 |
| **Author** | Claude (self-planned; countersign with the PR) |
| **Data classification** | Public records only (boundary polygons, elected officials). User linkage flows through the existing `user_jurisdictions` path — no new personal data collected or stored. |

## Problem

`myCountySupervisors` returns ALL of a county's supervisors and the briefing
unions them into "my reps" — a Sebastopol user (genuinely District 5) sees
District 1's supervisor listed as theirs. Nothing can filter: `jurisdictions`
holds zero supervisorial boundaries. Third of the three district bugs found on
one address; the other two (wrong-Congress vintage, seeded levels) are fixed.

## Discoveries that shaped this plan

- `COUNTY_SUPERVISOR_DISTRICT` **already exists** in the Prisma enum and the
  live DB type — no migration needed. It is missing from
  `BoundaryJurisdictionType` (packages/common) and the regions schema enum.
- No statewide source exists; supervisorial boundaries are county-published.
  Sonoma's is verified: `socogis.sonomacounty.ca.gov/.../BASEPublic/
  Supervisorial_Districts/FeatureServer/0` — 5 polygons, `SupNum` district
  number, and the county's own text places Sebastopol in the 5th.
- The boundary loader reads sources from `pluginRegistry.getActive()` — the
  state plugin only. County plugins are not registry objects; sync builds
  `DeclarativeRegionPlugin` per enabled `region_plugins` row
  (`parentRegionId != null`). The loader will mirror that exact pattern.
- `GeoportalLayerConfig` has no `districtField` (comment says "TIGER-only");
  supervisorial layers need it for `${district}` substitution.

## Subtasks

1. **Types** (`packages/common`): `COUNTY_SUPERVISOR_DISTRICT` into
   `BoundaryJurisdictionType`; `districtField?` onto `GeoportalLayerConfig`.
   `GeoportalFetcher` passes it through (one line + spec).
2. **Loader** (`boundary-loader.service.ts`): after the active-plugin
   sources, collect boundary sources from enabled county rows via
   `DeclarativeRegionPlugin` — each with its own ctx (county fipsCode) and its
   own `ocdIdPrefix` (already inside `BoundarySourcesConfig`). Extracted
   helper to stay under the SonarJS 15 gate. Counties without
   `boundarySources` are silently fine (all 57 others today).
3. **Query filter** (`region-query.service.ts`): `getMyCountySupervisors`
   additionally resolves the user's `COUNTY_SUPERVISOR_DISTRICT` jurisdiction
   (same primary-address join as the COUNTY lookup); numeric district match
   against `representatives.district` (digit-extraction on both sides, no
   zero-pad mismatch). **No supervisorial jurisdiction resolved → return all
   supervisors** — today's behavior stays for the 57 counties without data.
4. **Config** (opuspopuli-regions, stacked on #79): regions schema enum +
   `districtField` on GeoportalLayerConfig + regenerated types (drift gate);
   `sonoma.json` gains `config.boundarySources`:
   - `ocdIdPrefix: ocd-division/country:us/state:ca/county:sonoma`
   - geoportal layer: the socogis URL, `districtField/fipsField: SupNum`,
     `fipsPrefix: sup-06097-`, `jurisdictionType: COUNTY_SUPERVISOR_DISTRICT`,
     `level: COUNTY` (groups under County in the profile — the exact ask),
     `nameTemplate: Sonoma County Supervisorial District ${district}`.
5. **Resolution**: zero new code — the PostGIS containment walk picks up any
   jurisdiction with a boundary.
6. **Frontend**: zero code for the pilot — profile groups by `level`
   (COUNTY), briefing receives the server-filtered list.

## Verification (local, live stack)

Force boundary reload → 5 rows `sup-06097-1..5` with geometry → point-in-
polygon: Sebastopol → District 5, Petaluma → District 2 (per the county's own
descriptions) → address re-save → profile shows "Sonoma County Supervisorial
District 5" under County → `myCountySupervisors` returns exactly Hopkins.

## Risk register

- County GIS instability — medium × possible → same non-fatal fetch philosophy
  as every boundary layer; absence degrades to all-supervisors, never wrong-
  supervisor.
- 58 heterogeneous sources — medium × likely → per-county rollout behind the
  existing county-enable flag; this plan ships exactly one (Sonoma).
- District-number mismatch between roster and boundary source — low ×
  possible → both sides digit-extracted; Sonoma verified (`SupNum` 1–5 vs rep
  districts 1–5, and the layer's `Supervisor` attribute matches our roster).
- Branch stacking — this builds on #1138's loader; branch is cut from it and
  rebases onto main when #1138 merges.
