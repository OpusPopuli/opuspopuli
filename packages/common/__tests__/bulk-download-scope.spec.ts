import { createBulkDownloadScope } from "../src/utils/bulk-download-scope";

function download(name: string) {
  const release = jest.fn().mockResolvedValue(undefined);
  return { name, release };
}

describe("createBulkDownloadScope", () => {
  it("downloads a key once and shares the result", async () => {
    const scope = createBulkDownloadScope();
    const fetch = jest.fn().mockImplementation(async () => download("a"));

    const first = await scope.acquire("url", fetch);
    const second = await scope.acquire("url", fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("shares a download still in flight", async () => {
    const scope = createBulkDownloadScope();
    const fetch = jest.fn().mockImplementation(async () => download("a"));

    const [a, b] = await Promise.all([
      scope.acquire("url", fetch),
      scope.acquire("url", fetch),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("downloads different keys separately", async () => {
    const scope = createBulkDownloadScope();

    const a = await scope.acquire("one", async () => download("a"));
    const b = await scope.acquire("two", async () => download("b"));

    expect(a.name).toBe("a");
    expect(b.name).toBe("b");
  });

  it("holds a failure, so later sources do not fetch a newer export", async () => {
    const scope = createBulkDownloadScope();
    const fetch = jest.fn().mockRejectedValue(new Error("HTTP 503"));

    await expect(scope.acquire("url", fetch)).rejects.toThrow("HTTP 503");
    await expect(scope.acquire("url", fetch)).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("releases every download once on close, failures included", async () => {
    const scope = createBulkDownloadScope();
    const a = await scope.acquire("one", async () => download("a"));
    const b = await scope.acquire("two", async () => download("b"));
    await scope
      .acquire("three", () => Promise.reject(new Error("gone")))
      .catch(() => undefined);

    await scope.close();
    await scope.close();

    expect(a.release).toHaveBeenCalledTimes(1);
    expect(b.release).toHaveBeenCalledTimes(1);
  });

  it("refuses to acquire after close", async () => {
    const scope = createBulkDownloadScope();
    await scope.close();
    const fetch = jest.fn();

    await expect(scope.acquire("url", fetch)).rejects.toThrow(
      "Download scope closed",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
