import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  PluginRegistryService,
  type BoundarySourcesConfig,
} from '@opuspopuli/region-provider';
import { TigerFetcher } from './boundary-fetchers/tiger.fetcher';
import { GeoportalFetcher } from './boundary-fetchers/geoportal.fetcher';
import type {
  BoundaryRow,
  RegionContext,
} from './boundary-fetchers/arcgis.utils';

// Re-export so existing imports of `BoundaryRow` from this module stay
// valid. The type now lives in arcgis.utils.ts so the shared builder helper
// can construct it without a circular dependency.
export type { BoundaryRow };

/**
 * Number of upsert operations issued in parallel during loadAll(). Each
 * row hits the DB twice (Prisma upsert + $executeRaw for geometry), so
 * 50 in flight means ~100 concurrent connections-worth of work at peak.
 * That sits well below the Prisma client's default pool limit (24 × 1.5x
 * burst) but materially reduces wall-clock load time vs sequential.
 *
 * Bump cautiously — too high and the boot-time load starves other queries
 * (jurisdiction-resolution, region sync) hitting the same pool.
 */
const UPSERT_CONCURRENCY = 50;

// BoundaryRow + the type itself moved to ./boundary-fetchers/arcgis.utils.ts
// so the shared row-builder helper (used by both fetchers) can construct
// it without circular module dependencies. Re-exported above so callers
// importing from this module are unaffected.

/** Outcome of a single loadAll() call. Surfaces enough detail for an
 * operator to tell loaded-vs-skipped, partial-vs-clean, at a glance. */
export interface BoundaryLoadResult {
  /** True when the load ran (or successfully skipped). False only on hard
   * errors the catch couldn't surface — currently nothing maps here. */
  ok: boolean;
  /** Reason loadAll() short-circuited without fetching. Absent on a real
   * run. */
  skipped?: 'no-active-plugin' | 'no-boundary-sources' | 'already-populated';
  counts: {
    /** Rows already in jurisdictions before this run. */
    existing: number;
    /** Rows successfully inserted or updated this run. */
    upserted: number;
    /** Rows that errored (per-row try/catch). */
    failed: number;
    /** Rows the fetchers returned without a fipsCode AND without an ocdId
     * — can't be upserted because there's no idempotency key. */
    missingKey: number;
  };
}

/**
 * Loads civic-boundary geometries (counties, cities, state legislative
 * districts, school districts, special districts) into the `jurisdictions`
 * table from the active region plugin's `boundarySources` config.
 *
 * Design (opuspopuli#804, paired with opuspopuli-regions#51):
 *  - Idempotent: skip-when-populated unless `force: true` is passed (via
 *    the admin refreshBoundaries mutation). The boot hook can be disabled
 *    entirely with `FORCE_RELOAD_BOUNDARIES=skip-boot` — useful for tests.
 *  - Non-fatal: per-row errors logged + counted, never thrown. The boot-time
 *    caller treats this as a detached background task.
 *  - Boot-time partial loads are recoverable: if the region service crashes
 *    or shuts down mid-load, the next admin refreshBoundaries({ force:
 *    true }) re-upserts every row idempotently. Skip-when-populated still
 *    kicks in on the next boot, so partial state is sticky until the
 *    operator runs the force refresh.
 *  - Bounded-context-correct: owned by the region service. db-migrate stays
 *    out of jurisdiction-table writes (which would violate bounded contexts
 *    per CLAUDE.md).
 *  - Fetchers are injected (subtask 5) — this service is the orchestrator
 *    + persistence layer only. Pure unit-testable surface.
 */
@Injectable()
export class BoundaryLoaderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BoundaryLoaderService.name);

  constructor(
    private readonly db: DbService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly tigerFetcher: TigerFetcher,
    private readonly geoportalFetcher: GeoportalFetcher,
  ) {}

  /**
   * Boot-time hook: fire `loadAll()` in the background after Nest finishes
   * wiring providers. Never await — health checks shouldn't block on a
   * 1–5 minute boundary fetch. Never throw — startup failures here would
   * brick the whole region service; the loader's own per-row try/catch
   * and skip-when-populated logic make this safe to invoke unconditionally.
   *
   * Disable via FORCE_RELOAD_BOUNDARIES=skip-boot (boot-time only; admin
   * mutation still works). This is mostly useful in integration tests
   * where the boot fetch would hit real TIGER/Geoportal URLs.
   */
  onApplicationBootstrap(): void {
    if (process.env.FORCE_RELOAD_BOUNDARIES === 'skip-boot') {
      this.logger.log(
        'BoundaryLoader: FORCE_RELOAD_BOUNDARIES=skip-boot — bypassing boot-time load.',
      );
      return;
    }
    // Detached call — drop the result. Catches any unexpected rejection so
    // bootstrap doesn't crash; loadAll's own per-row try/catch and skip
    // paths make this a defense-in-depth handler.
    this.loadAll().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `BoundaryLoader: boot-time load threw (this should never happen — loadAll catches per-row errors internally): ${message}`,
      );
    });
  }

  /**
   * Load all boundary geometries for the active region.
   * Caller is responsible for choosing detached-vs-awaited semantics
   * (main.ts boot-time: detached; admin mutation: awaited).
   */
  async loadAll(opts: { force?: boolean } = {}): Promise<BoundaryLoadResult> {
    const existing = await this.db.jurisdiction.count();
    const precheck = this.checkPreconditions(existing, opts);
    if ('skip' in precheck) return precheck.skip;

    const { sources, ctx } = precheck;
    const rows = await this.fetchAll(sources, ctx);
    const { upserted, failed, missingKey } = await this.executeUpserts(rows);

    this.logger.log(
      `BoundaryLoader: ${upserted} upserted, ${failed} failed, ${missingKey} skipped (no key). ` +
        `existing=${existing}, force=${opts.force ?? false}.`,
    );
    return {
      // ok = no per-row upsert errors. When the load succeeds partially
      // (some failed), this flips false so operators can write a single
      // boolean alarm against the result.
      ok: failed === 0,
      counts: { existing, upserted, failed, missingKey },
    };
  }

  /**
   * Run every precondition that can short-circuit the load. Returns either
   * a `{ skip }` wrapper with the early-return result, or a `{ sources, ctx }`
   * proceed payload. Pulling these out of loadAll() keeps each branch's
   * intent obvious and drops loadAll()'s cognitive complexity below the
   * SonarJS 15 gate.
   */
  private checkPreconditions(
    existing: number,
    opts: { force?: boolean },
  ):
    | { skip: BoundaryLoadResult }
    | { sources: BoundarySourcesConfig; ctx: RegionContext } {
    const baseCounts = { existing, upserted: 0, failed: 0, missingKey: 0 };

    const plugin = this.pluginRegistry.getActive();
    if (!plugin) {
      this.logger.warn(
        'BoundaryLoader: no active region plugin — skipping load.',
      );
      return {
        skip: { ok: true, skipped: 'no-active-plugin', counts: baseCounts },
      };
    }

    const sources = plugin.getBoundarySources?.();
    if (!sources) {
      this.logger.debug(
        `BoundaryLoader: plugin ${plugin.getName()} has no boundarySources — skipping load.`,
      );
      return {
        skip: { ok: true, skipped: 'no-boundary-sources', counts: baseCounts },
      };
    }

    if (existing > 0 && !opts.force) {
      this.logger.log(
        `BoundaryLoader: ${existing} jurisdictions already loaded — skipping. ` +
          `Run the refreshBoundaries(force: true) admin mutation to re-fetch.`,
      );
      return {
        skip: { ok: true, skipped: 'already-populated', counts: baseCounts },
      };
    }

    // Per-config substitution context. fipsCode + stateCode are sourced
    // from the active plugin's regionInfo; both are required for boundary
    // fetching. Plugins without them shouldn't declare boundarySources in
    // the first place — but if they do, log loudly and bail rather than
    // sending empty substitutions to TIGER (would silently return no rows).
    const info = plugin.getRegionInfo();
    if (!info.fipsCode || !info.stateCode) {
      this.logger.warn(
        `BoundaryLoader: plugin ${info.id} declared boundarySources but is missing ` +
          `fipsCode (${info.fipsCode ?? 'unset'}) or stateCode (${info.stateCode ?? 'unset'}) — skipping load.`,
      );
      return {
        skip: { ok: true, skipped: 'no-boundary-sources', counts: baseCounts },
      };
    }

    return {
      sources,
      ctx: { fipsCode: info.fipsCode, stateCode: info.stateCode },
    };
  }

  /**
   * Partition rows by upsertability then batch-upsert the keyed ones with
   * bounded concurrency. Per-row try/catch — one bad row doesn't abort
   * the batch. Returns the tally for loadAll() to fold into the result.
   */
  private async executeUpserts(
    rows: BoundaryRow[],
  ): Promise<{ upserted: number; failed: number; missingKey: number }> {
    let missingKey = 0;
    const upsertable: BoundaryRow[] = [];
    for (const row of rows) {
      if (!row.fipsCode && !row.ocdId) {
        // Skip silently-undocumented rows — the fetchers should already have
        // logged the gap. Count + move on so the load isn't aborted.
        missingKey++;
      } else {
        upsertable.push(row);
      }
    }

    // Batch the upserts. Each row triggers two roundtrips (Prisma upsert +
    // $executeRaw for PostGIS geometry); a flat sequential loop over 20k+
    // California rows costs minutes. UPSERT_CONCURRENCY parallel rows
    // amortizes the latency without overwhelming the connection pool.
    let upserted = 0;
    let failed = 0;
    for (let i = 0; i < upsertable.length; i += UPSERT_CONCURRENCY) {
      const batch = upsertable.slice(i, i + UPSERT_CONCURRENCY);
      const results = await Promise.all(
        batch.map((row) => this.tryUpsert(row)),
      );
      for (const r of results) {
        if (r.ok) upserted++;
        else failed++;
      }
    }

    return { upserted, failed, missingKey };
  }

  /**
   * One row's upsert with the per-row try/catch the orchestrator relies on.
   * Returns a result tag instead of throwing so `Promise.all` doesn't
   * cascade-cancel the rest of the batch on a single failure.
   */
  private async tryUpsert(
    row: BoundaryRow,
  ): Promise<{ ok: true } | { ok: false }> {
    try {
      await this.upsertBoundary(row);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `BoundaryLoader: upsert failed for ${row.type} ${row.name}: ${msg}`,
      );
      return { ok: false };
    }
  }

  /**
   * Fan out across TIGER + geoportal layers, accumulating BoundaryRows
   * from each. Each fetcher's `fetch()` already handles its own per-layer
   * error path (returns [] on network failure), so the load doesn't need
   * additional try/catch here — a transient outage in one layer just
   * yields zero rows for that layer.
   */
  private async fetchAll(
    sources: BoundarySourcesConfig,
    ctx: RegionContext,
  ): Promise<BoundaryRow[]> {
    const rows: BoundaryRow[] = [];

    for (const layer of sources.tigerLayers ?? []) {
      const batch = await this.tigerFetcher.fetch(
        layer,
        ctx,
        sources.ocdIdPrefix,
      );
      rows.push(...batch);
    }
    for (const layer of sources.geoportalLayers ?? []) {
      const batch = await this.geoportalFetcher.fetch(
        layer,
        ctx,
        sources.ocdIdPrefix,
      );
      rows.push(...batch);
    }

    return rows;
  }

  /**
   * Idempotent upsert of a single boundary row.
   *
   * Keying strategy: prefer fipsCode when present, fall back to ocdId. Each
   * column has its own unique constraint, so a single ON CONFLICT clause
   * can't cover both — we pick the right Prisma upsert based on which key
   * the row carries.
   *
   * PostGIS geometry write is a separate $executeRaw — Prisma can't emit
   * ST_Multi / ST_GeomFromGeoJSON. ST_Multi wraps Polygon → MultiPolygon
   * to match the `geography(MultiPolygon, 4326)` column type; TIGER + most
   * ArcGIS sources return single-Polygon features for sub-state divisions,
   * but counties / districts / special districts can return MultiPolygons
   * (islands, gerrymandered shapes), so we always normalize.
   */
  private async upsertBoundary(row: BoundaryRow): Promise<void> {
    const shared = {
      name: row.name,
      type: row.type,
      level: row.level,
      stateCode: row.stateCode,
    };

    let id: string;
    if (row.fipsCode) {
      const record = await this.db.jurisdiction.upsert({
        where: { fipsCode: row.fipsCode },
        create: {
          ...shared,
          fipsCode: row.fipsCode,
          ocdId: row.ocdId ?? null,
        },
        update: shared,
        select: { id: true },
      });
      id = record.id;
    } else if (row.ocdId) {
      const record = await this.db.jurisdiction.upsert({
        where: { ocdId: row.ocdId },
        create: { ...shared, fipsCode: null, ocdId: row.ocdId },
        update: shared,
        select: { id: true },
      });
      id = record.id;
    } else {
      // Defensive — loadAll() already filtered these out via missingKey.
      throw new Error(
        `BoundaryRow ${row.name} has no fipsCode or ocdId — upsert refused`,
      );
    }

    // Tagged-template $executeRaw — Prisma escapes the JSON parameter, so
    // there's no injection surface even though we're constructing geometry
    // SQL. ::text cast is required because $executeRaw infers string
    // parameters as jsonb by default for the ST_GeomFromGeoJSON overload
    // resolution, but ST_GeomFromGeoJSON wants text input.
    //
    // The `id` column is `text` in Postgres (Prisma's default for `String
    // @id @default(uuid())` without `@db.Uuid`) — do NOT cast ${id} to ::uuid
    // or Postgres rejects with `operator does not exist: text = uuid`.
    const geojson = JSON.stringify(row.geometryGeoJSON);
    await this.db.$executeRaw`
      UPDATE jurisdictions
      SET boundary = ST_Multi(ST_GeomFromGeoJSON(${geojson}::text))
      WHERE id = ${id}
    `;
  }
}
