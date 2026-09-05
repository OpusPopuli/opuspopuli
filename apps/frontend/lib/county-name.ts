/**
 * Match a county by name across two sources that spell it differently.
 *
 * The Census geocoder writes the bare name into `UserAddress.county`
 * ("Sonoma"); the region service publishes the display name in
 * `CountyThreshold.name` ("Sonoma County"). Comparing them directly fails for
 * all 58, and the failure is silent: the reader just never sees their number.
 *
 * The backend has the same normalisation in
 * `apps/backend/src/apps/region/src/domains/county-threshold-sync.service.ts`.
 * It is duplicated rather than shared because the frontend deliberately takes
 * no workspace-package dependency — pulling `@opuspopuli/common` into the
 * Cloudflare Worker bundle for six lines is the worse trade. Change one, check
 * the other.
 */
export function normalizeCountyName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+County$/i, "")
    .toLowerCase();
}

/** Finds the entry whose name is the same place as `name`, or null. */
export function findByCountyName<T extends { name: string }>(
  items: readonly T[],
  name: string | null | undefined,
): T | null {
  if (!name) return null;
  const target = normalizeCountyName(name);
  return items.find((i) => normalizeCountyName(i.name) === target) ?? null;
}
