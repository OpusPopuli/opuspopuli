import {
  IngestionWatermarkService,
  type IngestionWatermarkRecord,
  type IngestionWatermarkRepository,
} from "../src/manifest/ingestion-watermark.service";

class InMemoryWatermarkRepo implements IngestionWatermarkRepository {
  private store = new Map<string, IngestionWatermarkRecord>();

  private key(regionId: string, sourceUrl: string, dataType: string): string {
    return `${regionId}::${sourceUrl}::${dataType}`;
  }

  async findFirst(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
  }): Promise<IngestionWatermarkRecord | null> {
    return (
      this.store.get(
        this.key(
          args.where.regionId,
          args.where.sourceUrl,
          args.where.dataType,
        ),
      ) ?? null
    );
  }

  async upsert(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
    create: Omit<IngestionWatermarkRecord, "createdAt" | "updatedAt">;
    update: Partial<IngestionWatermarkRecord>;
  }): Promise<IngestionWatermarkRecord> {
    const k = this.key(
      args.where.regionId,
      args.where.sourceUrl,
      args.where.dataType,
    );
    const existing = this.store.get(k);
    const now = new Date();
    if (!existing) {
      const record: IngestionWatermarkRecord = {
        ...args.create,
        createdAt: now,
        updatedAt: now,
      };
      this.store.set(k, record);
      return record;
    }

    // Mimic Prisma's `{ increment: N }` semantics for itemsIngested.
    const itemsIngested = (() => {
      const u = args.update.itemsIngested;
      if (typeof u === "number") return u;
      if (
        u &&
        typeof u === "object" &&
        "increment" in (u as Record<string, unknown>)
      ) {
        return (
          existing.itemsIngested +
          ((u as unknown as { increment: number }).increment ?? 0)
        );
      }
      return existing.itemsIngested;
    })();

    const updated: IngestionWatermarkRecord = {
      ...existing,
      ...args.update,
      itemsIngested,
      updatedAt: now,
    };
    this.store.set(k, updated);
    return updated;
  }
}

describe("IngestionWatermarkService", () => {
  let repo: InMemoryWatermarkRepo;
  let svc: IngestionWatermarkService;

  beforeEach(() => {
    repo = new InMemoryWatermarkRepo();
    svc = new IngestionWatermarkService(repo);
  });

  it("returns undefined when no watermark exists", async () => {
    const wm = await svc.read("ca", "https://example/journals", "meetings");
    expect(wm).toBeUndefined();
  });

  it("creates a fresh watermark on first advance", async () => {
    const wm = await svc.advance(
      "ca",
      "https://example/journals",
      "meetings",
      "ca-meetings-2026-04-28",
      1,
    );
    expect(wm.lastExternalId).toBe("ca-meetings-2026-04-28");
    expect(wm.itemsIngested).toBe(1);
    expect(wm.lastIngestedAt).toBeInstanceOf(Date);
  });

  it("advances an existing watermark and increments itemsIngested", async () => {
    await svc.advance("ca", "https://x", "meetings", "id-1", 1);
    const second = await svc.advance("ca", "https://x", "meetings", "id-2", 3);
    expect(second.lastExternalId).toBe("id-2");
    expect(second.itemsIngested).toBe(4);
  });

  it("scopes watermarks per (region, sourceUrl, dataType)", async () => {
    await svc.advance("ca", "https://x", "meetings", "ca-id", 1);
    await svc.advance("tx", "https://x", "meetings", "tx-id", 1);

    const ca = await svc.read("ca", "https://x", "meetings");
    const tx = await svc.read("tx", "https://x", "meetings");
    expect(ca?.lastExternalId).toBe("ca-id");
    expect(tx?.lastExternalId).toBe("tx-id");
  });
});
