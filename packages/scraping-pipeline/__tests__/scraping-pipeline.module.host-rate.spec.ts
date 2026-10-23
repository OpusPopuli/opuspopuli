import type { FactoryProvider, Provider } from "@nestjs/common";
import { ScrapingPipelineModule } from "../src/scraping-pipeline.module";
import { ApiIngestHandler } from "../src/handlers/api-ingest.handler";
import { BulkDownloadHandler } from "../src/handlers/bulk-download.handler";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";

/**
 * S1 — the module hands `ExtractionProvider`'s per-host slot to the handlers
 * that fetch on their own (the FEC paths). The handler specs prove a handler
 * waits on a slot it is given; this proves the module gives it one, and
 * cannot be built without one.
 */
describe("ScrapingPipelineModule — host slot wiring (S1)", () => {
  const factoryFor = (token: unknown): FactoryProvider => {
    const providers = (ScrapingPipelineModule.forRoot().providers ??
      []) as Provider[];
    const found = providers.find(
      (p) => typeof p === "object" && "provide" in p && p.provide === token,
    );
    return found as FactoryProvider;
  };

  const extraction = {
    acquireHostSlot: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => extraction.acquireHostSlot.mockClear());

  it("gives the API handler the provider's slot", async () => {
    const handler = factoryFor(ApiIngestHandler).useFactory(
      {},
      undefined,
      extraction,
    ) as { hostSlot: (url: string) => Promise<void> };

    await handler.hostSlot("https://api.open.fec.gov/v1/x");

    expect(extraction.acquireHostSlot).toHaveBeenCalledWith(
      "https://api.open.fec.gov/v1/x",
    );
  });

  it("gives the bulk-download handler the provider's slot", async () => {
    const handler = factoryFor(BulkDownloadHandler).useFactory(
      {},
      undefined,
      undefined,
      extraction,
    ) as { hostSlot: (url: string) => Promise<void> };

    await handler.hostSlot("https://www.fec.gov/files/x.zip");

    expect(extraction.acquireHostSlot).toHaveBeenCalledWith(
      "https://www.fec.gov/files/x.zip",
    );
  });

  it.each([
    ["the API handler", ApiIngestHandler],
    ["the bulk-download handler", BulkDownloadHandler],
  ])("REQUIRES ExtractionProvider for %s", (_name, token) => {
    // The factories are called directly above, so only this pins the inject
    // they depend on. Optional, a refactor that lost it would pass every
    // other test and leave the FEC paths unthrottled.
    const inject = factoryFor(token).inject ?? [];
    expect(inject).toContain(ExtractionProvider);
  });
});
