import { LinkDiscoveryService } from "../src/crawling/link-discovery.service";
import type { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { DataType, type DataSourceConfig } from "@opuspopuli/common";

// Fixture: registrar hub → per-election pages → measures-filed leaf (#1164).
const HUB_URL = "https://county.gov/registrar-of-voters/elections";

const HUB_HTML = `<html><body><nav><a href="/contact">Contact Us</a></nav>
  <ul>
    <li><a href="/registrar-of-voters/elections/june-2-2026-primary-election">June 2, 2026, Primary Election</a></li>
    <li><a href="/registrar-of-voters/elections/november-3-2026-general-election">November 3, 2026, General Election</a></li>
    <li><a href="https://electionstats.county.ca.gov">Election Returns Archives</a></li>
  </ul></body></html>`;

const NOVEMBER_HTML = `<html><body>
  <a href="/registrar-of-voters/elections/november-3-2026-general-election-local-candidates">List of Local Candidates Who Have Filed</a>
  <a href="/registrar-of-voters/elections/november-3-2026-general-election-local-measures">List of Local Measures That Have Been Filed</a>
</body></html>`;

const JUNE_HTML = `<html><body>
  <a href="/registrar-of-voters/elections/june-2-2026-primary-election-timeline">Election Timeline</a>
</body></html>`;

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: HUB_URL,
    dataType: DataType.PROPOSITIONS,
    contentGoal: "Extract measures",
    linkDiscovery: {
      steps: [
        { textPattern: "(Primary|General|Special) Election", select: "all" },
        { textPattern: "Local Measures That Have Been Filed" },
      ],
    },
    ...overrides,
  };
}

function mockExtractionFor(
  pages: Record<string, string>,
): jest.Mocked<ExtractionProvider> {
  return {
    fetchWithRetry: jest.fn().mockImplementation(async (url: string) => {
      const html = pages[url];
      if (html === undefined) throw new Error(`404 for ${url}`);
      return { content: html, url, statusCode: 200, cached: false };
    }),
  } as unknown as jest.Mocked<ExtractionProvider>;
}

const DEFAULT_PAGES: Record<string, string> = {
  [HUB_URL]: HUB_HTML,
  "https://county.gov/registrar-of-voters/elections/june-2-2026-primary-election":
    JUNE_HTML,
  "https://county.gov/registrar-of-voters/elections/november-3-2026-general-election":
    NOVEMBER_HTML,
};

describe("LinkDiscoveryService (#1164)", () => {
  it("walks hub → elections → measures leaf and returns only final-step pages", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(createSource());

    expect(result.errors).toEqual([]);
    expect(result.leafUrls).toEqual([
      "https://county.gov/registrar-of-voters/elections/november-3-2026-general-election-local-measures",
    ]);
    // June page has no measures link yet — soft warning, not an error.
    expect(
      result.warnings.some((w) => w.includes("june-2-2026-primary-election")),
    ).toBe(true);
  });

  it("select: 'first' follows only the first match per page", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          steps: [{ textPattern: "Election", select: "first" }],
        },
      }),
    );

    expect(result.errors).toEqual([]);
    expect(result.leafUrls).toEqual([
      "https://county.gov/registrar-of-voters/elections/june-2-2026-primary-election",
    ]);
  });

  it("hrefPattern additionally filters resolved URLs", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          steps: [
            {
              textPattern: "Election",
              hrefPattern: "november-3-2026",
              select: "all",
            },
          ],
        },
      }),
    );

    expect(result.leafUrls).toEqual([
      "https://county.gov/registrar-of-voters/elections/november-3-2026-general-election",
    ]);
  });

  it("stays on the seed's host — off-host anchors never match", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          // "Election Returns Archives" matches this text but lives on
          // electionstats.county.ca.gov — must be excluded by host scope.
          steps: [{ textPattern: "Election Returns", select: "all" }],
        },
      }),
    );

    expect(result.leafUrls).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("errors loudly when a step matches zero links on every page (staleness alarm)", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          steps: [{ textPattern: "Measures That Have Been Withdrawn" }],
        },
      }),
    );

    expect(result.leafUrls).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("matched no links");
    expect(result.errors[0]).toContain("linkDiscovery step 1");
  });

  it("soft-fails a page fetch error but errors when every page of a step fails", async () => {
    const pages = { [HUB_URL]: HUB_HTML }; // election pages 404
    const service = new LinkDiscoveryService(mockExtractionFor(pages));
    const result = await service.discover(createSource());

    expect(result.leafUrls).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(
      result.warnings.filter((w) => w.includes("fetch failed")),
    ).toHaveLength(2);
  });

  it("caps each level at maxLeafPages and warns about the trim", async () => {
    const manyLinks = Array.from(
      { length: 8 },
      (_, i) =>
        `<a href="/registrar-of-voters/elections/e${i}">Special Election ${i}</a>`,
    ).join("");
    const pages: Record<string, string> = {
      [HUB_URL]: `<html><body>${manyLinks}</body></html>`,
    };
    for (let i = 0; i < 8; i++) {
      pages[`https://county.gov/registrar-of-voters/elections/e${i}`] =
        "<html><body></body></html>";
    }
    const service = new LinkDiscoveryService(mockExtractionFor(pages));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          steps: [{ textPattern: "Special Election", select: "all" }],
          maxLeafPages: 3,
        },
      }),
    );

    expect(result.leafUrls).toHaveLength(3);
    expect(result.warnings.some((w) => w.includes("capped"))).toBe(true);
  });

  it("dedupes the same target linked from multiple pages", async () => {
    const shared =
      "https://county.gov/registrar-of-voters/elections/shared-measures";
    const pageA = `<a href="${shared}">Local Measures That Have Been Filed</a>`;
    const pages: Record<string, string> = {
      ...DEFAULT_PAGES,
      "https://county.gov/registrar-of-voters/elections/june-2-2026-primary-election": `<html><body>${pageA}</body></html>`,
      "https://county.gov/registrar-of-voters/elections/november-3-2026-general-election": `<html><body>${pageA}</body></html>`,
    };
    const service = new LinkDiscoveryService(mockExtractionFor(pages));
    const result = await service.discover(createSource());

    expect(result.leafUrls).toEqual([shared]);
  });

  it("clamps an invalid maxLeafPages instead of returning zero leaves silently", async () => {
    // maxLeafPages: 0 would slice every level to empty and return
    // "no leaves, no errors" — a silent empty sync, the failure this
    // feature exists to eliminate.
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          steps: [{ textPattern: "(Primary|General|Special) Election" }],
          maxLeafPages: 0,
        },
      }),
    );

    expect(result.errors).toEqual([]);
    expect(result.leafUrls.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("maxLeafPages=0"))).toBe(
      true,
    );
  });

  it("errors when a step's href pattern is invalid", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          steps: [{ textPattern: "Election", hrefPattern: "(unclosed" }],
        },
      }),
    );

    expect(result.errors[0]).toContain("invalid regex");
  });

  it("errors when the config declares no steps", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({ linkDiscovery: { steps: [] } }),
    );

    expect(result.errors[0]).toContain("at least one step");
  });

  it("does not follow a page that redirects out of scope", async () => {
    // The fetcher follows redirects, so checking only the anchor URL would let
    // an open redirect on the county host move the request to an internal
    // service, whose body would then feed anchor matching and LLM analysis.
    const extraction = {
      fetchWithRetry: jest.fn().mockImplementation(async (url: string) => {
        if (url === HUB_URL) {
          return { content: HUB_HTML, url, statusCode: 200, cached: false };
        }
        return {
          content:
            "<html><body><a href='/x'>Local Measures That Have Been Filed</a></body></html>",
          url,
          statusCode: 200,
          cached: false,
          finalUrl: "http://ollama:11434/api/tags",
          redirectedFrom: url,
        };
      }),
    } as unknown as jest.Mocked<ExtractionProvider>;

    const service = new LinkDiscoveryService(extraction);
    const result = await service.discover(createSource());

    expect(result.leafUrls).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes("redirected out of scope")),
    ).toBe(true);
  });

  it("rejects a non-HTTPS seed", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor({}));
    const result = await service.discover(
      createSource({ url: "http://county.gov/elections" }),
    );

    expect(result.errors[0]).toContain("HTTPS");
  });

  it("rejects an invalid step regex as a config error", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: { steps: [{ textPattern: "(unclosed" }] },
      }),
    );

    expect(result.errors[0]).toContain("invalid regex");
  });

  it("matches anchor text case-insensitively", async () => {
    const service = new LinkDiscoveryService(mockExtractionFor(DEFAULT_PAGES));
    const result = await service.discover(
      createSource({
        linkDiscovery: {
          steps: [{ textPattern: "november 3, 2026, general election" }],
        },
      }),
    );

    expect(result.leafUrls).toEqual([
      "https://county.gov/registrar-of-voters/elections/november-3-2026-general-election",
    ]);
  });
});
