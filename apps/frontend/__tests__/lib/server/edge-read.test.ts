/**
 * @jest-environment node
 *
 * The Worker's server-side reads (#1456). Node, not jsdom: the Worker signs
 * with WebCrypto, which jsdom doesn't provide.
 */
import {
  EDGE_READ_HEADER,
  edgeQuery,
  signEdgeRead,
} from "@/lib/server/edge-read";

// Shared with the gateway's edge-read-signature.spec.ts: the Worker signs
// with WebCrypto and the gateway checks with node:crypto, so both must
// produce exactly this.
const SECRET = "opuspopuli-edge-read-test-secret-0001";
const PATH = "/api?query=%7B+regionInfo+%7B+name+%7D+%7D";
const NOW = 1_700_000_000_000;
const VECTOR =
  "1700000000.b3c6ea6a3cbad10bd2fbf4ab1d8a48e4871d13f46dcc7fb4e2256334b7e96ce3";

const ENDPOINT = "https://api.example.org/api";

function ok(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("edge reads (#1456)", () => {
  it("signs to the vector the gateway checks", async () => {
    expect(await signEdgeRead(SECRET, PATH, NOW)).toBe(VECTOR);
  });

  it("asks as a cacheable GET, with the query in the URL", async () => {
    const fetchImpl = jest.fn(() =>
      ok({ data: { regionInfo: { name: "CA" } } }),
    );
    const data = await edgeQuery<{ regionInfo: { name: string } }>(
      "{ regionInfo { name } }",
      { id: "x" },
      { ttl: 60, fetchImpl, endpoint: ENDPOINT, secret: "" },
    );
    expect(data).toEqual({ regionInfo: { name: "CA" } });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { cf: unknown; next: unknown },
    ];
    const sent = new URL(url);
    expect(sent.origin + sent.pathname).toBe(ENDPOINT);
    expect(sent.searchParams.get("query")).toBe("{ regionInfo { name } }");
    expect(sent.searchParams.get("variables")).toBe('{"id":"x"}');
    expect(init.method).toBe("GET");
    expect(init.cf).toEqual({ cacheTtl: 60, cacheEverything: true });
    expect(init.next).toEqual({ revalidate: 60 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Apollo refuses a preflight-less GET as possible CSRF.
    expect(init.headers).toMatchObject({ "apollo-require-preflight": "true" });
  });

  it("signs the exact path and query it sends, when it holds a secret", async () => {
    const fetchImpl = jest.fn(() => ok({ data: {} }));
    await edgeQuery("{ bills { total } }", undefined, {
      ttl: 60,
      fetchImpl,
      endpoint: ENDPOINT,
      secret: SECRET,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    const signature = init.headers[EDGE_READ_HEADER];
    const [timestamp] = signature.split(".");
    const sent = new URL(url);
    expect(signature).toBe(
      await signEdgeRead(
        SECRET,
        sent.pathname + sent.search,
        Number(timestamp) * 1000,
      ),
    );
  });

  it("goes unsigned without a usable secret", async () => {
    for (const secret of ["", "too-short"]) {
      const fetchImpl = jest.fn(() => ok({ data: {} }));
      await edgeQuery("{ x }", undefined, {
        ttl: 60,
        fetchImpl,
        endpoint: ENDPOINT,
        secret,
      });
      const [, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        { headers: Record<string, string> },
      ];
      expect(init.headers[EDGE_READ_HEADER]).toBeUndefined();
    }
  });

  it.each([
    ["a 429", () => Promise.resolve(new Response("{}", { status: 429 }))],
    [
      "a GraphQL error",
      () => ok({ errors: [{ message: "boom" }], data: null }),
    ],
    ["a network failure", () => Promise.reject(new Error("offline"))],
    ["a timeout", () => Promise.reject(new DOMException("t", "TimeoutError"))],
  ])("returns null, never throws, on %s", async (_label, impl) => {
    const fetchImpl = jest.fn(impl) as unknown as typeof fetch;
    await expect(
      edgeQuery("{ x }", undefined, {
        ttl: 60,
        fetchImpl,
        endpoint: ENDPOINT,
        secret: "",
      }),
    ).resolves.toBeNull();
  });
});
