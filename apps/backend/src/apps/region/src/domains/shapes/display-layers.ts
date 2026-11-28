import type {
  BoundarySourcesConfig,
  TigerLayerConfig,
} from '@opuspopuli/region-provider';

/**
 * Display layers whose rows can't be told apart (#1475).
 *
 * Each display layer owns the rows of its jurisdiction type whose code
 * starts with its `fipsPrefix`. Two layers of one type whose prefixes
 * overlap — equal, or one a prefix of the other ('' overlaps everything) —
 * would both claim the same rows: each fetch would mark the other's rows
 * "not covered", and both would look stale forever. Such layers are
 * ambiguous config, not something to guess at: they're left out, loudly.
 *
 * Returns the ambiguous layers (by identity) and one message per clash.
 *
 * The same rule rejects such configs in opuspopuli-regions
 * (`src/cli/lib/display-layers.ts`). Change both together.
 */
export function ambiguousDisplayLayers(groups: BoundarySourcesConfig[]): {
  layers: Set<TigerLayerConfig>;
  clashes: string[];
} {
  const withDisplay = groups.flatMap((g) =>
    (g.tigerLayers ?? []).filter((l) => l.display),
  );
  const layers = new Set<TigerLayerConfig>();
  const clashes: string[] = [];
  withDisplay.forEach((a, i) => {
    for (const b of withDisplay.slice(i + 1)) {
      if (a.jurisdictionType !== b.jurisdictionType) continue;
      const pa = a.fipsPrefix ?? '';
      const pb = b.fipsPrefix ?? '';
      if (pa.startsWith(pb) || pb.startsWith(pa)) {
        layers.add(a);
        layers.add(b);
        clashes.push(
          `${a.jurisdictionType} display layers '${a.display?.layerName}' (prefix '${pa}') ` +
            `and '${b.display?.layerName}' (prefix '${pb}') claim the same rows`,
        );
      }
    }
  });
  return { layers, clashes };
}
