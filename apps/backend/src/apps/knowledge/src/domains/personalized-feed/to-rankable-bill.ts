import type { Prisma } from '@opuspopuli/relationaldb-provider';

import type { RankableBill } from './scoring.service';

/**
 * Coerce a raw bill row (with JSON `aiSummary`) into the typed
 * `RankableBill` shape both ranker services consume.
 *
 * Returns `null` when:
 *   - `aiSummary` is missing or not an object — v1.0 rankers can't score
 *     without `{ topics, whoItAffects }`
 *   - `aiSummary.skip === true` — the bill-analysis pipeline marks
 *     not-a-bill / garbled inputs with this sentinel and we want them
 *     dropped from every ranker
 *   - both `topics` and `whoItAffects` are empty after filtering
 *
 * Lives at the domain level (not inside either ranker module) so the
 * bill-feed and rep-activity rankers share one drop-set without
 * cross-module circular imports.
 */
export function toRankableBill(row: {
  id: string;
  lastActionDate: Date | null;
  sourceUrl: string | null;
  aiSummary: Prisma.JsonValue;
}): RankableBill | null {
  if (
    !row.aiSummary ||
    typeof row.aiSummary !== 'object' ||
    Array.isArray(row.aiSummary)
  ) {
    return null;
  }
  const obj = row.aiSummary as Record<string, unknown>;
  if (obj.skip === true) return null;

  const topics = Array.isArray(obj.topics)
    ? obj.topics.filter((t): t is string => typeof t === 'string')
    : [];
  const whoItAffects = Array.isArray(obj.whoItAffects)
    ? obj.whoItAffects.filter((w): w is string => typeof w === 'string')
    : [];

  if (topics.length === 0 && whoItAffects.length === 0) return null;

  return {
    id: row.id,
    lastActionDate: row.lastActionDate,
    sourceUrl: row.sourceUrl,
    aiSummary: { topics, whoItAffects },
  };
}
